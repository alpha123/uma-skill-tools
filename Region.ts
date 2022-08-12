// half-open interval [start,end)
export class Region {
	constructor(readonly start: number, readonly end: number) {}

	intersect(other: {start: number, end: number}) {
		const start = Math.max(this.start, other.start);
		const end = Math.min(this.end, other.end);
		if (end <= start) {
			return new Region(-1, -1);
		} else {
			return new Region(start, end);
		}
	}

	fullyContains(other: {start: number, end: number}) {
		return this.start <= other.start && this.end >= other.end;
	}
}

export class RegionList extends Array<Region> {
	rmap(f: (r: Region) => Region | Region[]) {
		const out = new RegionList();
		this.forEach(r => {
			const newr = f(r);
			if (Array.isArray(newr)) {
				newr.forEach(nr => {
					if (nr.start > -1) {
						out.push(nr);
					}
				});
			}
			else if (newr.start > -1) {
				out.push(newr);
			}
		});
		return out;
	}

	union(other: RegionList) {
		const u: Region[] = [];
		const r = new RegionList();
		u.push.apply(u, this);
		u.push.apply(u, other);
		if (u.length == 0) {
			return r;
		}
		u.sort((a,b) => a.start - b.start);
		r.push(u.reduce((a,b) => {
			if (a.fullyContains(b)) {
				return a;
			} else if (a.start <= b.start && b.start < a.end) {
				return new Region(a.start, b.end);
			} else if (a.start < b.end && b.end <= a.end) {
				return new Region(b.start, a.end);
			} else {
				r.push(a);
				return b;
			}
		}));
		return r;
	}
}
