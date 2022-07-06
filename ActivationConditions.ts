import { CourseData, CourseHelpers, Phase } from './CourseData';
import { HorseParameters, StrategyHelpers } from './HorseTypes';

// half-open interval [start,end)
export class Region {
	constructor(readonly start: number, readonly end: number) {}

	intersect(other: {start: number, end: number}) {
		const start = Math.max(this.start, other.start);
		const end = Math.min(this.end, other.end);
		if (end < start) {
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

export interface Operator {
	samplePolicy: ActivationSamplePolicy
	apply(regions: RegionList, course: CourseData, horse: HorseParameters): RegionList
}

export class EqOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return this.condition.filterEq(regions, this.argument, course, horse);
	}
}

export class NeqOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return this.condition.filterNeq(regions, this.argument, course, horse);
	}
}

export class LtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return this.condition.filterLt(regions, this.argument, course, horse);
	}
}

export class LteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return this.condition.filterLte(regions, this.argument, course, horse);
	}
}

export class GtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return this.condition.filterGt(regions, this.argument, course, horse);
	}
}

export class GteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return this.condition.filterGte(regions, this.argument, course, horse);
	}
}

export class AndOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly left: Operator, readonly right: Operator) {
		this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		const leftval = this.left.apply(regions, course, horse);
		return this.right.apply(leftval, course, horse);
	}
}

export class OrOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly left: Operator, readonly right: Operator) {
		// not entirely clear what the right thing to do here is
		// but i'm pretty sure there are no skills with disjunctive conditions that
		// would have different sample policies (probably)
		this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		const leftval = this.left.apply(regions, course, horse);
		const rightval = this.right.apply(regions, course, horse);
		return leftval.union(rightval);
	}
}

export interface ActivationSamplePolicy {
	sample(regions: RegionList, nsamples: number): number[]
	reconcile(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileAsap(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
	reconcileAllCornerRandom(other: ActivationSamplePolicy): ActivationSamplePolicy
}

const AsapPolicy = Object.freeze({
	sample(regions: RegionList, _: number) { return regions.length > 0 ? [regions[0].start] : []; },
	reconcile(other: ActivationSamplePolicy) { return other.reconcileAsap(this); },
	reconcileAsap(other: ActivationSamplePolicy) { return other; },
	reconcileRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
});

const RandomPolicy = Object.freeze({
	sample(regions: RegionList, nsamples: number) {
		if (regions.length == 0) {
			return [];
		}
		var acc = 0;
		const weights = regions.map(r => acc += r.end - r.start);
		const samples = [];
		for (var i = 0; i < nsamples; ++i) {
			const threshold = Math.random() * weights[weights.length-1];
			const region = regions.find((_,i) => weights[i] > threshold)!;
			samples.push(region.start + Math.floor(Math.random() * (region.end - region.start + 1)));
		}
		return samples;
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileRandom(this); },
	reconcileAsap(_: ActivationSamplePolicy) { return this; },
	reconcileRandom(other: ActivationSamplePolicy) { return other; },
	reconcileAllCornerRandom(other: ActivationSamplePolicy) { return other; }
});

const AllCornerRandomPolicy = Object.freeze({
	sample(regions: RegionList, nsamples: number) {
		//TODO
		return [0];
	},
	reconcile(other: ActivationSamplePolicy) { return other.reconcileAllCornerRandom(this); },
	reconcileAsap(_: ActivationSamplePolicy) { return this; },
	reconcileRandom(_: ActivationSamplePolicy) { return this; },
	reconcileAllCornerRandom(_: ActivationSamplePolicy) { return this; }
});

export interface Condition {
	samplePolicy: ActivationSamplePolicy
	filterEq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList
	filterNeq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList
	filterLt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList
	filterLte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList
	filterGt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList
	filterGte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList
}

class AssertionError extends Error {
	constructor(msg: string) {
		super('Assertion failed: ' + msg);
	}
}

function assert(cond: boolean, msg: string): asserts cond {
	if (!cond) throw new AssertionError(msg);
}

function notSupported(_0: RegionList, _1: number, _2: CourseData, _3: HorseParameters): never {
	assert(false, 'unsupported comparison');
}

function noop(regions: RegionList, _1: number, _2: CourseData, _3: HorseParameters) {
	return regions;
}

const noopAsap = Object.freeze({
	samplePolicy: AsapPolicy,
	filterEq: noop,
	filterNeq: noop,
	filterLt: noop,
	filterLte: noop,
	filterGt: noop,
	filterGte: noop
});

const noopRandom = Object.freeze({
	samplePolicy: RandomPolicy,
	filterEq: noop,
	filterNeq: noop,
	filterLt: noop,
	filterLte: noop,
	filterGt: noop,
	filterGte: noop
});

const defaultAsap = Object.freeze({
	samplePolicy: AsapPolicy,
	filterEq: notSupported,
	filterNeq: notSupported,
	filterLt: notSupported,
	filterLte: notSupported,
	filterGt: notSupported,
	filterGte: notSupported
});

function asap(o) {
	return Object.assign({}, defaultAsap, o);
}

const defaultRandom = Object.freeze({
	samplePolicy: RandomPolicy,
	filterEq: notSupported,
	filterNeq: notSupported,
	filterLt: notSupported,
	filterLte: notSupported,
	filterGt: notSupported,
	filterGte: notSupported
});

function random(o) {
	return Object.assign({}, defaultRandom, o);
}

/*
	accumulatetime, activate_count_all, activate_count_end_after, activate_count_heal, activate_count_middle, activate_count_start,
	all_corner_random, always, bashin_diff_behind, bashin_diff_infront, behind_near_lane_time, behind_near_lane_time_set1, blocked_all_continuetime,
	blocked_front, blocked_front_continuetime, blocked_side_continuetime, change_order_onetime, change_order_up_end_after,
	change_order_up_finalcorner_after, compete_fight_count, corner, corner_random, distance_diff_rate, distance_diff_top, distance_rate,
	distance_rate_after_random, distance_type, down_slope_random, grade, ground_condition, ground_type, hp_per, infront_near_lane_time, is_badstart,
	is_basis_distance, is_behind_in, is_exist_chara_id, is_finalcorner, is_finalcorner_laterhalf, is_finalcorner_random, is_hp_empty_onetime,
	is_last_straight_onetime, is_lastspurt, is_move_lane, is_overtake, is_surrounded, is_temptation, lane_type, last_straight_random, near_count,
	order, order_rate, order_rate_in20_continue, order_rate_in40_continue, order_rate_out40_continue, order_rate_out50_continue,
	order_rate_out70_continue, overtake_target_no_order_up_time, overtake_target_time, phase, phase_firsthalf_random, phase_laterhalf_random,
	phase_random, popularity, post_number, random_lot, remain_distance, remain_distance_viewer_id, rotation, running_style,
	running_style_count_nige_otherself, running_style_count_oikomi_otherself, running_style_count_same, running_style_count_same_rate,
	running_style_count_sashi_otherself, running_style_count_senko_otherself, running_style_equal_popularity_one,
	running_style_temptation_count_nige, running_style_temptation_count_oikomi, running_style_temptation_count_sashi,
	running_style_temptation_count_senko, same_skill_horse_count, season, slope, straight_front_type, straight_random, temptation_count,
	temptation_count_behind, temptation_count_infront, track_id, up_slope_random, weather
*/

export const Conditions: {[cond: string]: Condition} = Object.freeze({
	corner: asap({
		filterEq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters) {
			if (cornerNum == 0) {
				return regions.rmap(r => course.straights.map(s => r.intersect(s)));
			} else {
				const corner = course.corners[cornerNum];
				const cornerBounds = new Region(corner.start, corner.start + corner.length);
				return regions.rmap(r => r.intersect(cornerBounds));
			}
		},
		filterNeq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters) {
			assert(cornerNum == 0, 'only supports corner!=0');
			const corners = course.corners.map(c => new Region(c.start, c.start + c.length));
			return regions.rmap(r => corners.map(c => r.intersect(c)));
		}
	}),
	distance_diff_top: noopAsap,
	distance_rate: asap({
		filterGte(regions: RegionList, rate: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance * rate / 100, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	distance_type: asap({
		filterEq(regions: RegionList, distanceType: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsDistanceType(distanceType);
			if (course.distanceType == distanceType) {
				return regions;
			} else {
				return new RegionList();
			}
		}
	}),
	down_slope_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be down_slope_random==1');
			const slopes = course.slopes.filter(s => s.slope < 0).map(s => new Region(s.start, s.start + s.length));
			return regions.rmap(r => slopes.map(s => r.intersect(s)));
		}
	}),
	is_last_straight_onetime: asap({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_last_straight_onetime==1');
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraightStart = course.straights[course.straights.length - 1].start;
			// TODO ask kuromi about this or something
			const trigger = new Region(lastStraightStart, lastStraightStart + 10);
			return regions.rmap(r => r.intersect(trigger));
		}
	}),
	order: noopAsap,
	order_rate: noopAsap,
	phase: {
		samplePolicy: AsapPolicy,
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterNeq: notSupported,
		filterLt(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			assert(phase > 0, 'phase == 0');
			const bounds = new Region(0, CourseHelpers.phaseStart(course.distance, (phase - 1) as Phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterLte(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(0, CourseHelpers.phaseStart(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGt(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			assert(phase < 3, 'phase > 2');
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, (phase + 1) as Phase), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	},
	phase_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	remain_distance: asap({
		filterLte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance - remain, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(0, course.distance - remain);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	rotation: asap({
		filterEq(regions: RegionList, rotation: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsOrientation(rotation);
			return course.turn == rotation ? regions : new RegionList();
		}
	}),
	running_style: asap({
		filterEq(regions: RegionList, strategy: number, _: CourseData, horse: HorseParameters) {
			StrategyHelpers.assertIsStrategy(strategy);
			if (StrategyHelpers.strategyMatches(horse.strategy, strategy)) {
				return regions;
			} else {
				return new RegionList();
			}
		}
	}),
	slope: asap({
		filterEq(regions: RegionList, slopeType: number, course: CourseData, _: HorseParameters) {
			assert(slopeType == 0 || slopeType == 1 || slopeType == 2, 'slopeType');
			// Requires course.slopes is sorted by slope start— this is not always the case, since in course_data.json they are
			// (sometimes?) sorted first by uphill/downhill and then by start. They should be sorted when the course is loaded.
			assert(CourseHelpers.isSortedByStart(course.slopes), 'course slopes must be sorted by slope start');
			var lastEnd = 0;
			const slopes = course.slopes.filter(s => (slopeType != 2 && s.slope > 0) || (slopeType != 1 && s.slope < 0));
			const slopeR = slopeType == 0 ? slopes.map(s => {
				const r = new Region(lastEnd, s.start);
				lastEnd = s.start + s.length;
				return r;
			}) : slopes.map(s => new Region(s.start, s.start + s.length));
			if (slopeType == 0 && lastEnd != course.distance) {
				slopeR.push(new Region(lastEnd, course.distance));
			}
			return regions.rmap(r => slopeR.map(s => r.intersect(s)));
		}
	}),
	up_slope_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be up_slope_random==1');
			const slopes = course.slopes.filter(s => s.slope > 0).map(s => new Region(s.start, s.start + s.length));
			return regions.rmap(r => slopes.map(s => r.intersect(s)));
		}
	})
});
