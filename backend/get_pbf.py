#!/usr/bin/env python3
"""
osm_pbf_analyzer.py
===================
Single-pass analysis + schema export for OpenStreetMap .osm.pbf files.

Install:
    pip install osmium            # pyosmium
    pip install matplotlib        # optional, only for --plots

Usage:
    python osm_pbf_analyzer.py delhi.osm.pbf -o out/
    python osm_pbf_analyzer.py delhi.osm.pbf -o out/ --plots --top 30
    python osm_pbf_analyzer.py big.osm.pbf  -o out/ --no-geometry   # faster, less RAM

Outputs (in the output directory):
    schema.json        Full schema: attributes, tag keys (freq, distinct values, top values),
                       way node-count stats, relation member types/roles
    schema_tags.csv    Flat table of tag keys per element type (easy to open in Excel)
    report.json        Machine-readable analysis results
    report.md          Human-readable analysis report
    *.png              Charts (if --plots)
"""

import argparse
import csv
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone

try:
    import osmium
except ImportError:
    sys.exit("pyosmium is required:  pip install osmium")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def haversine_m(lon1, lat1, lon2, lat2):
    """Great-circle distance in metres."""
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


class RunningStats:
    """Min / max / mean without storing all values."""

    __slots__ = ("n", "total", "min", "max")

    def __init__(self):
        self.n = 0
        self.total = 0.0
        self.min = float("inf")
        self.max = float("-inf")

    def add(self, x):
        self.n += 1
        self.total += x
        if x < self.min:
            self.min = x
        if x > self.max:
            self.max = x

    def as_dict(self):
        if not self.n:
            return {"count": 0}
        return {
            "count": self.n,
            "min": self.min,
            "max": self.max,
            "mean": round(self.total / self.n, 3),
        }


class TagSchema:
    """Tracks tag key frequency and (capped) value distribution for one element type."""

    def __init__(self, max_distinct=5000):
        self.max_distinct = max_distinct
        self.key_count = Counter()
        self.values = defaultdict(Counter)
        self.overflow = set()  # keys whose distinct values exceeded cap
        self.elements_with_tags = 0
        self.total = 0
        self.tags_per_element = Counter()

    def add(self, tags):
        self.total += 1
        n = 0
        for t in tags:
            n += 1
            k, v = t.k, t.v
            self.key_count[k] += 1
            if k in self.overflow:
                continue
            c = self.values[k]
            if v not in c and len(c) >= self.max_distinct:
                self.overflow.add(k)
                continue
            c[v] += 1
        if n:
            self.elements_with_tags += 1
        self.tags_per_element[min(n, 20)] += 1

    def to_schema(self, top_values=10):
        out = {}
        for k, cnt in self.key_count.most_common():
            vals = self.values[k]
            out[k] = {
                "count": cnt,
                "pct_of_elements": round(100 * cnt / self.total, 4) if self.total else 0,
                "distinct_values": len(vals),
                "distinct_is_lower_bound": k in self.overflow,
                "top_values": vals.most_common(top_values),
                "inferred_type": infer_type(vals),
            }
        return out


def infer_type(value_counter):
    """Guess a data type from observed values (int / float / bool(yes|no) / text)."""
    if not value_counter:
        return "text"
    sample = list(value_counter)[:500]
    if all(v in ("yes", "no") for v in sample):
        return "boolean(yes/no)"
    try:
        for v in sample:
            int(v)
        return "integer"
    except ValueError:
        pass
    try:
        for v in sample:
            float(v.replace(",", "."))
        return "number"
    except ValueError:
        pass
    return "text"


# --------------------------------------------------------------------------- #
# Main handler
# --------------------------------------------------------------------------- #
class OSMAnalyzer(osmium.SimpleHandler):
    def __init__(self, max_distinct=5000, with_geometry=True, grid_deg=0.05):
        super().__init__()
        self.with_geometry = with_geometry
        self.grid_deg = grid_deg

        # counts + tag schemas
        self.counts = Counter()
        self.tag_schema = {
            "node": TagSchema(max_distinct),
            "way": TagSchema(max_distinct),
            "relation": TagSchema(max_distinct),
        }

        # metadata
        self.users = Counter()
        self.by_year = defaultdict(Counter)  # year -> {node/way/relation: n}
        self.min_ts = None
        self.max_ts = None
        self.version_hist = Counter()
        self.invisible = 0
        self.max_ids = {"node": 0, "way": 0, "relation": 0}
        self.changesets = set()
        self.max_changeset_track = 5_000_000  # cap memory

        # geometry
        self.bbox = [float("inf"), float("inf"), float("-inf"), float("-inf")]  # minx miny maxx maxy
        self.grid = Counter()  # tagged-node (POI) density
        self.tagged_nodes = 0

        # ways
        self.way_nodes = RunningStats()
        self.way_nodes_hist = Counter()
        self.closed_ways = 0
        self.way_length_by_highway = defaultdict(float)
        self.way_count_by_highway = Counter()
        self.total_highway_m = 0.0
        self.bad_geometry_ways = 0
        self.oneway = Counter()
        self.surface = Counter()
        self.maxspeed = Counter()
        self.lanes = Counter()

        # relations
        self.rel_members = RunningStats()
        self.rel_types = Counter()
        self.member_types = Counter()
        self.member_roles = defaultdict(Counter)  # relation type -> role counter

        # thematic
        self.amenity = Counter()
        self.shop = Counter()
        self.tourism = Counter()
        self.leisure = Counter()
        self.landuse = Counter()
        self.natural = Counter()
        self.building = Counter()
        self.railway = Counter()
        self.waterway = Counter()
        self.public_transport = Counter()
        self.name_langs = Counter()
        self.completeness = defaultdict(Counter)  # theme -> {total, has_name, ...}
        self.building_levels = Counter()
        self.wikidata = 0

    # ----- common per-element bookkeeping ----- #
    def _meta(self, kind, o):
        self.counts[kind] += 1
        if o.id > self.max_ids[kind]:
            self.max_ids[kind] = o.id
        if not o.visible:
            self.invisible += 1
        self.version_hist[min(o.version, 30)] += 1
        if o.user:
            self.users[o.user] += 1
        if len(self.changesets) < self.max_changeset_track:
            self.changesets.add(o.changeset)
        try:
            ts = o.timestamp
            if ts:
                self.by_year[ts.year][kind] += 1
                if self.min_ts is None or ts < self.min_ts:
                    self.min_ts = ts
                if self.max_ts is None or ts > self.max_ts:
                    self.max_ts = ts
        except Exception:
            pass

    def _thematic(self, kind, tags):
        d = {t.k: t.v for t in tags}
        if not d:
            return d
        if "amenity" in d:
            self.amenity[d["amenity"]] += 1
        if "shop" in d:
            self.shop[d["shop"]] += 1
        if "tourism" in d:
            self.tourism[d["tourism"]] += 1
        if "leisure" in d:
            self.leisure[d["leisure"]] += 1
        if "landuse" in d:
            self.landuse[d["landuse"]] += 1
        if "natural" in d:
            self.natural[d["natural"]] += 1
        if "building" in d:
            self.building[d["building"]] += 1
            c = self.completeness["building"]
            c["total"] += 1
            for f in ("name", "building:levels", "height", "addr:housenumber", "addr:street"):
                if f in d:
                    c[f] += 1
            if "building:levels" in d:
                self.building_levels[d["building:levels"]] += 1
        if "railway" in d:
            self.railway[d["railway"]] += 1
        if "waterway" in d:
            self.waterway[d["waterway"]] += 1
        if "public_transport" in d:
            self.public_transport[d["public_transport"]] += 1
        if "wikidata" in d:
            self.wikidata += 1
        for k in d:
            if k.startswith("name:"):
                self.name_langs[k[5:]] += 1
        if "amenity" in d:
            c = self.completeness["amenity"]
            c["total"] += 1
            for f in ("name", "opening_hours", "phone", "website", "wheelchair"):
                if f in d:
                    c[f] += 1
        return d

    # ----- callbacks ----- #
    def node(self, n):
        self._meta("node", n)
        self.tag_schema["node"].add(n.tags)
        try:
            if n.location.valid():
                lon, lat = n.location.lon, n.location.lat
                b = self.bbox
                b[0] = min(b[0], lon)
                b[1] = min(b[1], lat)
                b[2] = max(b[2], lon)
                b[3] = max(b[3], lat)
                if len(n.tags):
                    self.tagged_nodes += 1
                    g = self.grid_deg
                    self.grid[(math.floor(lon / g) * g, math.floor(lat / g) * g)] += 1
        except Exception:
            pass
        if len(n.tags):
            self._thematic("node", n.tags)

    def way(self, w):
        self._meta("way", w)
        self.tag_schema["way"].add(w.tags)
        nn = len(w.nodes)
        self.way_nodes.add(nn)
        self.way_nodes_hist[min(nn // 10 * 10, 100)] += 1
        if w.is_closed():
            self.closed_ways += 1

        d = self._thematic("way", w.tags) if len(w.tags) else {}

        hw = d.get("highway")
        if hw:
            self.way_count_by_highway[hw] += 1
            if "oneway" in d:
                self.oneway[d["oneway"]] += 1
            if "surface" in d:
                self.surface[d["surface"]] += 1
            if "maxspeed" in d:
                self.maxspeed[d["maxspeed"]] += 1
            if "lanes" in d:
                self.lanes[d["lanes"]] += 1

            if self.with_geometry:
                length = self._way_length(w)
                if length is not None:
                    self.way_length_by_highway[hw] += length
                    self.total_highway_m += length

    def _way_length(self, w):
        total = 0.0
        prev = None
        try:
            for nd in w.nodes:
                loc = nd.location
                if not loc.valid():
                    self.bad_geometry_ways += 1
                    return None
                if prev is not None:
                    total += haversine_m(prev[0], prev[1], loc.lon, loc.lat)
                prev = (loc.lon, loc.lat)
        except osmium.InvalidLocationError:
            self.bad_geometry_ways += 1
            return None
        return total

    def relation(self, r):
        self._meta("relation", r)
        self.tag_schema["relation"].add(r.tags)
        rtype = r.tags.get("type", "(none)")
        self.rel_types[rtype] += 1
        n = 0
        for m in r.members:
            n += 1
            self.member_types[m.type] += 1  # 'n', 'w', 'r'
            self.member_roles[rtype][m.role or "(empty)"] += 1
        self.rel_members.add(n)
        if len(r.tags):
            self._thematic("relation", r.tags)


# --------------------------------------------------------------------------- #
# Output builders
# --------------------------------------------------------------------------- #
ATTRIBUTE_SCHEMA = {
    "id": "int64",
    "version": "int32",
    "timestamp": "datetime (UTC)",
    "changeset": "int64",
    "uid": "int32",
    "user": "string",
    "visible": "bool",
    "tags": "map<string,string>",
}


def read_header(path):
    info = {}
    try:
        with osmium.io.Reader(path) as rd:
            h = rd.header()
            box = h.box()
            info["generator"] = h.get("generator")
            info["replication_timestamp"] = h.get("osmosis_replication_timestamp")
            info["replication_base_url"] = h.get("osmosis_replication_base_url")
            info["replication_sequence"] = h.get("osmosis_replication_sequence_number")
            try:
                if box.valid():
                    bl, tr = box.bottom_left, box.top_right
                    info["header_bbox"] = [bl.lon, bl.lat, tr.lon, tr.lat]
            except Exception:
                pass
    except Exception as e:  # header is best-effort
        info["header_error"] = str(e)
    return info


def build_schema(a, path, header):
    schema = {
        "file": os.path.basename(path),
        "file_size_mb": round(os.path.getsize(path) / 1e6, 2),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "header": header,
        "common_attributes": ATTRIBUTE_SCHEMA,
        "element_types": {},
    }
    for kind in ("node", "way", "relation"):
        ts = a.tag_schema[kind]
        entry = {
            "count": a.counts[kind],
            "elements_with_tags": ts.elements_with_tags,
            "distinct_tag_keys": len(ts.key_count),
            "tag_keys": ts.to_schema(),
        }
        if kind == "node":
            entry["extra_fields"] = {"location": "lon/lat (float64, 1e-7 deg precision)"}
        elif kind == "way":
            entry["extra_fields"] = {"nodes": "list<int64> of node refs"}
            entry["node_count_stats"] = a.way_nodes.as_dict()
            entry["closed_ways"] = a.closed_ways
        else:
            entry["extra_fields"] = {"members": "list<{type(n|w|r), ref, role}>"}
            entry["member_count_stats"] = a.rel_members.as_dict()
            entry["relation_types"] = dict(a.rel_types.most_common())
            entry["member_types"] = dict(a.member_types)
            entry["roles_by_relation_type"] = {
                t: dict(c.most_common(15)) for t, c in a.member_roles.items()
            }
        schema["element_types"][kind] = entry
    return schema


def write_schema_csv(schema, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(
            ["element_type", "tag_key", "count", "pct_of_elements", "distinct_values",
             "distinct_is_lower_bound", "inferred_type", "top_values"]
        )
        for kind, e in schema["element_types"].items():
            for k, s in e["tag_keys"].items():
                top = "; ".join(f"{v}({c})" for v, c in s["top_values"][:5])
                w.writerow([kind, k, s["count"], s["pct_of_elements"], s["distinct_values"],
                            s["distinct_is_lower_bound"], s["inferred_type"], top])


def build_report(a, top):
    total = sum(a.counts.values())
    bbox = None if a.bbox[0] == float("inf") else [round(x, 6) for x in a.bbox]
    top_cells = [
        {"lon": round(lon, 4), "lat": round(lat, 4), "tagged_nodes": c}
        for (lon, lat), c in a.grid.most_common(top)
    ]
    users_total = len(a.users)
    top_users = a.users.most_common(top)
    top10_share = round(100 * sum(c for _, c in a.users.most_common(10)) / total, 2) if total else 0

    def comp(theme):
        c = a.completeness.get(theme)
        if not c or not c["total"]:
            return {}
        return {k: round(100 * v / c["total"], 2) for k, v in c.items() if k != "total"} | {
            "total": c["total"]
        }

    return {
        "overview": {
            "counts": dict(a.counts),
            "total_elements": total,
            "tagged_nodes": a.tagged_nodes,
            "bbox_minlon_minlat_maxlon_maxlat": bbox,
            "oldest_edit": a.min_ts.isoformat() if a.min_ts else None,
            "latest_edit": a.max_ts.isoformat() if a.max_ts else None,
            "max_ids": a.max_ids,
            "deleted_elements_in_file": a.invisible,
            "distinct_contributors": users_total,
            "distinct_changesets": len(a.changesets),
            "top10_contributors_share_pct": top10_share,
        },
        "contributors": {"top": top_users},
        "edits_by_year": {str(y): dict(c) for y, c in sorted(a.by_year.items())},
        "version_histogram": dict(sorted(a.version_hist.items())),
        "roads": {
            "total_km": round(a.total_highway_m / 1000, 2),
            "ways_by_highway": a.way_count_by_highway.most_common(top),
            "km_by_highway": [
                (k, round(v / 1000, 2))
                for k, v in sorted(a.way_length_by_highway.items(), key=lambda x: -x[1])[:top]
            ],
            "oneway": a.oneway.most_common(10),
            "surface": a.surface.most_common(top),
            "maxspeed": a.maxspeed.most_common(top),
            "lanes": a.lanes.most_common(10),
            "ways_skipped_bad_geometry": a.bad_geometry_ways,
        },
        "ways": {
            "node_count": a.way_nodes.as_dict(),
            "closed_ways": a.closed_ways,
            "nodes_per_way_histogram_bucket10": dict(sorted(a.way_nodes_hist.items())),
        },
        "relations": {
            "types": a.rel_types.most_common(top),
            "member_count": a.rel_members.as_dict(),
        },
        "features": {
            "amenity": a.amenity.most_common(top),
            "shop": a.shop.most_common(top),
            "tourism": a.tourism.most_common(top),
            "leisure": a.leisure.most_common(top),
            "landuse": a.landuse.most_common(top),
            "natural": a.natural.most_common(top),
            "building": a.building.most_common(top),
            "railway": a.railway.most_common(top),
            "waterway": a.waterway.most_common(top),
            "public_transport": a.public_transport.most_common(top),
        },
        "completeness_pct": {"building": comp("building"), "amenity": comp("amenity")},
        "building_levels_top": a.building_levels.most_common(10),
        "languages": {"name_lang_tags": a.name_langs.most_common(top),
                      "elements_with_wikidata": a.wikidata},
        "poi_hotspots": {"grid_deg": a.grid_deg, "top_cells": top_cells},
        "tag_usage": {
            k: {
                "elements_with_tags_pct": round(
                    100 * ts.elements_with_tags / max(ts.total, 1), 2
                ),
                "top_keys": ts.key_count.most_common(top),
            }
            for k, ts in a.tag_schema.items()
        },
    }


def _table(rows, headers):
    if not rows:
        return "_no data_\n"
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out) + "\n"


def write_markdown(rep, schema, path, elapsed):
    o = rep["overview"]
    L = []
    L.append(f"# OSM PBF Analysis: {schema['file']}\n")
    L.append(f"_Generated {schema['generated_at']} · size {schema['file_size_mb']} MB · "
             f"processed in {elapsed:.1f}s_\n")
    L.append("## Overview\n")
    L.append(_table(
        [("Nodes", f"{o['counts'].get('node', 0):,}"),
         ("Ways", f"{o['counts'].get('way', 0):,}"),
         ("Relations", f"{o['counts'].get('relation', 0):,}"),
         ("Tagged nodes (POIs etc.)", f"{o['tagged_nodes']:,}"),
         ("Bounding box", o["bbox_minlon_minlat_maxlon_maxlat"]),
         ("Oldest / latest edit", f"{o['oldest_edit']} / {o['latest_edit']}"),
         ("Contributors", f"{o['distinct_contributors']:,}"),
         ("Top-10 contributors share", f"{o['top10_contributors_share_pct']}%"),
         ("Deleted elements in file", o["deleted_elements_in_file"])],
        ["Metric", "Value"]))

    L.append("## Schema summary\n")
    for kind, e in schema["element_types"].items():
        L.append(f"### {kind.title()} ({e['count']:,})\n")
        L.append(f"- Elements with tags: {e['elements_with_tags']:,}")
        L.append(f"- Distinct tag keys: {e['distinct_tag_keys']:,}")
        L.append(f"- Extra fields: {e['extra_fields']}\n")
        rows = [(k, s["count"], f"{s['pct_of_elements']}%", s["distinct_values"], s["inferred_type"])
                for k, s in list(e["tag_keys"].items())[:15]]
        L.append(_table(rows, ["Tag key", "Count", "% of elements", "Distinct values", "Type"]))

    L.append("## Contributors\n")
    L.append(_table(rep["contributors"]["top"][:15], ["User", "Edits"]))

    L.append("## Edits by year\n")
    L.append(_table([(y, c.get("node", 0), c.get("way", 0), c.get("relation", 0))
                     for y, c in rep["edits_by_year"].items()],
                    ["Year", "Nodes", "Ways", "Relations"]))

    r = rep["roads"]
    L.append(f"## Road network (total {r['total_km']:,} km)\n")
    km = dict(r["km_by_highway"])
    L.append(_table([(k, c, km.get(k, "-")) for k, c in r["ways_by_highway"][:15]],
                    ["highway=", "Ways", "Length (km)"]))
    L.append("**Surface:** " + ", ".join(f"{k} ({v})" for k, v in r["surface"][:8]) + "\n")
    L.append("**Max speed:** " + ", ".join(f"{k} ({v})" for k, v in r["maxspeed"][:8]) + "\n")

    for name in ("amenity", "shop", "tourism", "leisure", "landuse", "building", "railway"):
        L.append(f"## Top `{name}` values\n")
        L.append(_table(rep["features"][name][:12], ["Value", "Count"]))

    L.append("## Data completeness\n")
    for theme, c in rep["completeness_pct"].items():
        if c:
            L.append(f"**{theme}** ({c['total']:,} features): " +
                     ", ".join(f"{k}: {v}%" for k, v in c.items() if k != "total") + "\n")

    L.append("## Relations\n")
    L.append(_table(rep["relations"]["types"][:12], ["type=", "Count"]))

    L.append("## Name translations (name:xx)\n")
    L.append(_table(rep["languages"]["name_lang_tags"][:12], ["Language", "Count"]))

    L.append("## POI hotspots (tagged nodes per grid cell)\n")
    L.append(_table([(c["lon"], c["lat"], c["tagged_nodes"])
                     for c in rep["poi_hotspots"]["top_cells"][:10]],
                    ["lon (SW corner)", "lat (SW corner)", "Tagged nodes"]))

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(L))


def make_plots(rep, outdir):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed; skipping plots (pip install matplotlib)")
        return

    def bar(pairs, title, fname, xlabel="", horizontal=True, n=15):
        pairs = pairs[:n]
        if not pairs:
            return
        labels = [str(p[0]) for p in pairs]
        vals = [p[1] for p in pairs]
        fig, ax = plt.subplots(figsize=(9, 5))
        if horizontal:
            ax.barh(labels[::-1], vals[::-1])
        else:
            ax.bar(labels, vals)
            plt.xticks(rotation=45)
        ax.set_title(title)
        ax.set_xlabel(xlabel)
        fig.tight_layout()
        fig.savefig(os.path.join(outdir, fname), dpi=130)
        plt.close(fig)

    bar(rep["roads"]["km_by_highway"], "Road length by highway type", "roads_km.png", "km")
    bar(rep["features"]["amenity"], "Top amenities", "amenities.png", "count")
    bar(rep["features"]["building"], "Building types", "buildings.png", "count")
    bar(rep["contributors"]["top"], "Top contributors (edits)", "contributors.png", "edits")

    years = list(rep["edits_by_year"])
    if years:
        fig, ax = plt.subplots(figsize=(9, 4.5))
        bottom = [0] * len(years)
        for kind in ("node", "way", "relation"):
            vals = [rep["edits_by_year"][y].get(kind, 0) for y in years]
            ax.bar(years, vals, bottom=bottom, label=kind)
            bottom = [b + v for b, v in zip(bottom, vals)]
        ax.set_title("Element last-edit year")
        ax.legend()
        plt.xticks(rotation=45)
        fig.tight_layout()
        fig.savefig(os.path.join(outdir, "edits_by_year.png"), dpi=130)
        plt.close(fig)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Analyse an OSM .pbf file and export its schema.")
    ap.add_argument("pbf", help="Path to .osm.pbf file")
    ap.add_argument("-o", "--outdir", default="osm_output", help="Output directory")
    ap.add_argument("--top", type=int, default=20, help="Rows in top-N lists (default 20)")
    ap.add_argument("--max-distinct", type=int, default=5000,
                    help="Max distinct values tracked per tag key (memory cap)")
    ap.add_argument("--no-geometry", action="store_true",
                    help="Skip node-location index (no road lengths; faster, low RAM)")
    ap.add_argument("--index", default="flex_mem",
                    help="pyosmium location index (flex_mem, sparse_mem_array, dense_mmap_array...)")
    ap.add_argument("--grid", type=float, default=0.05, help="POI hotspot grid size in degrees")
    ap.add_argument("--plots", action="store_true", help="Write PNG charts (needs matplotlib)")
    args = ap.parse_args()

    if not os.path.isfile(args.pbf):
        sys.exit(f"File not found: {args.pbf}")
    os.makedirs(args.outdir, exist_ok=True)

    print(f"Reading {args.pbf} ({os.path.getsize(args.pbf) / 1e6:.1f} MB) ...")
    header = read_header(args.pbf)
    analyzer = OSMAnalyzer(args.max_distinct, not args.no_geometry, args.grid)

    t0 = time.time()
    if args.no_geometry:
        analyzer.apply_file(args.pbf)
    else:
        analyzer.apply_file(args.pbf, locations=True, idx=args.index)
    elapsed = time.time() - t0
    print(f"Parsed {sum(analyzer.counts.values()):,} elements in {elapsed:.1f}s")

    schema = build_schema(analyzer, args.pbf, header)
    report = build_report(analyzer, args.top)

    with open(os.path.join(args.outdir, "schema.json"), "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, ensure_ascii=False, default=str)
    write_schema_csv(schema, os.path.join(args.outdir, "schema_tags.csv"))
    with open(os.path.join(args.outdir, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    write_markdown(report, schema, os.path.join(args.outdir, "report.md"), elapsed)
    if args.plots:
        make_plots(report, args.outdir)

    # console summary
    o = report["overview"]
    print("\n=== Summary ===")
    print(f"Nodes:      {o['counts'].get('node', 0):>12,}")
    print(f"Ways:       {o['counts'].get('way', 0):>12,}")
    print(f"Relations:  {o['counts'].get('relation', 0):>12,}")
    print(f"BBox:       {o['bbox_minlon_minlat_maxlon_maxlat']}")
    print(f"Contributors: {o['distinct_contributors']:,}")
    if not args.no_geometry:
        print(f"Road network: {report['roads']['total_km']:,} km")
    print(f"\nOutputs written to: {os.path.abspath(args.outdir)}")


if __name__ == "__main__":
    main()