import { htmlToText } from "./dom";
import { pageLinks } from "./search";
import { ROOT, type Records } from "./store";
import { isTrashed, pageTrail } from "./tree";

/** How the graph of pages is drawn. Kept with the other settings, so it is the same next time. */
export interface GraphOptions {
  /** ring: every page on one circle. groups: a cluster per top-level page. force: linked pages pull together. */
  layout: "force" | "groups" | "ring";
  /** Lines from a page to its sub-pages. */
  children: boolean;
  /** Lines for links and mentions between pages. */
  mentions: boolean;
  /** Include database rows (they are pages too, but there can be very many). */
  rows: boolean;
  /** Include pages with no line to any other page. */
  orphans: boolean;
  labels: boolean;
  /** Draw pages with more lines as bigger dots. */
  sizeByLinks: boolean;
  /** Colour each page by the top-level page it sits under. */
  colorByGroup: boolean;
}

export const GRAPH_DEFAULTS: GraphOptions = {
  layout: "force",
  children: true,
  mentions: true,
  rows: false,
  orphans: true,
  labels: true,
  sizeByLinks: true,
  colorByGroup: true,
};

export interface GraphNode {
  id: string;
  title: string;
  /** The top-level page this page sits under (itself, for a top-level page). */
  group: string;
  /** How many lines touch it. */
  degree: number;
}
export interface GraphLink {
  from: string;
  to: string;
  kind: "child" | "mention";
}

/** The pages and lines to draw for the given options. */
export function buildGraph(records: Records, options: GraphOptions): { nodes: GraphNode[]; links: GraphLink[] } {
  const pages = Object.values(records).filter(
    (block) => block.type === "page" && block.id !== ROOT && !isTrashed(records, block.id) && (options.rows || records[block.parent ?? ""]?.type !== "database"),
  );
  const shown = new Set(pages.map((page) => page.id));
  const seen = new Set<string>();
  const links = pageLinks(records).filter((link) => {
    const key = `${link.kind}:${link.from}:${link.to}`;
    if (seen.has(key) || !shown.has(link.from) || !shown.has(link.to) || !(link.kind === "child" ? options.children : options.mentions)) return false;
    seen.add(key);
    return true;
  });
  const degree = new Map<string, number>();
  for (const link of links) for (const id of [link.from, link.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const nodes = pages
    .filter((page) => options.orphans || degree.has(page.id))
    .map((page) => ({ id: page.id, title: htmlToText(page.text) || "Untitled", group: pageTrail(records, page.id)[0] ?? page.id, degree: degree.get(page.id) ?? 0 }));
  return { nodes, links };
}

type Point = { x: number; y: number };

const ring = (count: number, cx: number, cy: number, radius: number) =>
  Array.from({ length: count }, (_, index) => {
    const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * (count === 1 ? 0 : radius), y: cy + Math.sin(angle) * (count === 1 ? 0 : radius) };
  });

/**
 * Where to draw each page inside a square of the given size. The result is
 * the same every time for the same pages and lines: nothing is random.
 */
export function layoutGraph(nodes: GraphNode[], links: GraphLink[], layout: GraphOptions["layout"], size: number): Map<string, Point> {
  const margin = 60;
  const middle = size / 2;
  const positions = new Map<string, Point>();
  if (layout === "groups") {
    const groups = [...new Set(nodes.map((node) => node.group))];
    const centres = ring(groups.length, middle, middle, middle - margin - 70);
    groups.forEach((group, index) => {
      const members = nodes.filter((node) => node.group === group);
      ring(members.length, centres[index].x, centres[index].y, Math.min(70, 14 + members.length * 6)).forEach((point, i) => positions.set(members[i].id, point));
    });
    return positions;
  }
  ring(nodes.length, middle, middle, middle - margin).forEach((point, index) => positions.set(nodes[index].id, point));
  if (layout === "ring" || nodes.length < 3) return positions;

  // Force-directed: every pair of pages pushes apart, every line pulls its two ends together,
  // and each step moves a little less than the one before, so the picture settles.
  const ideal = (size - margin * 2) / Math.sqrt(nodes.length);
  const tied = links.filter((link) => positions.has(link.from) && positions.has(link.to));
  for (let step = 0; step < 250; step++) {
    const limit = (size / 10) * (1 - step / 250);
    const push = new Map(nodes.map((node): [string, Point] => [node.id, { x: 0, y: 0 }]));
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const [p, q] = [positions.get(nodes[a].id)!, positions.get(nodes[b].id)!];
        // two pages on the very same spot are nudged apart along a fixed direction
        const [dx, dy] = p.x === q.x && p.y === q.y ? [0.01 * (a + 1), 0.01] : [p.x - q.x, p.y - q.y];
        const distance = Math.hypot(dx, dy);
        const force = (ideal * ideal) / distance / distance;
        push.get(nodes[a].id)!.x += dx * force;
        push.get(nodes[a].id)!.y += dy * force;
        push.get(nodes[b].id)!.x -= dx * force;
        push.get(nodes[b].id)!.y -= dy * force;
      }
    }
    for (const link of tied) {
      const [p, q] = [positions.get(link.from)!, positions.get(link.to)!];
      const [dx, dy] = [p.x - q.x, p.y - q.y];
      const force = Math.hypot(dx, dy) / ideal;
      push.get(link.from)!.x -= dx * force;
      push.get(link.from)!.y -= dy * force;
      push.get(link.to)!.x += dx * force;
      push.get(link.to)!.y += dy * force;
    }
    for (const node of nodes) {
      const at = positions.get(node.id)!;
      const move = push.get(node.id)!;
      // a gentle pull to the middle keeps unconnected pages from drifting to the edges
      move.x += (middle - at.x) * 0.05;
      move.y += (middle - at.y) * 0.05;
      const length = Math.hypot(move.x, move.y) || 1;
      const stride = Math.min(length, limit);
      positions.set(node.id, {
        x: Math.min(size - margin, Math.max(margin, at.x + (move.x / length) * stride)),
        y: Math.min(size - margin, Math.max(margin, at.y + (move.y / length) * stride)),
      });
    }
  }
  return positions;
}
