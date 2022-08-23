const assert = require('assert').strict;

import { CourseData, CourseHelpers, Phase } from './CourseData';
import { HorseParameters, StrategyHelpers } from './HorseTypes';
import { Region, RegionList } from './Region';
import { RaceState, DynamicCondition } from './RaceSolver';
import {
	ActivationSamplePolicy,
	ImmediatePolicy, RandomPolicy,
	DistributionRandomPolicy, UniformRandomPolicy, LogNormalRandomPolicy, ErlangRandomPolicy,
	StraightRandomPolicy, AllCornerRandomPolicy
} from './ActivationSamplePolicy';

// K as in SKI combinators
function kTrue(_: RaceState) {
	return true;
}

function withDefaultCond(r: RegionList | [RegionList, DynamicCondition]) {
	if (r instanceof RegionList) {
		return [r, kTrue] as [RegionList, DynamicCondition];
	}
	return r;
}

export interface Operator {
	samplePolicy: ActivationSamplePolicy
	apply(regions: RegionList, course: CourseData, horse: HorseParameters): [RegionList, DynamicCondition]
}

export interface CmpOperator extends Operator {
	condition: Condition
	argument: number
}

export class EqOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterEq(regions, this.argument, course, horse));
	}
}

export class NeqOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterNeq(regions, this.argument, course, horse));
	}
}

export class LtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterLt(regions, this.argument, course, horse));
	}
}

export class LteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterLte(regions, this.argument, course, horse));
	}
}

export class GtOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterGt(regions, this.argument, course, horse));
	}
}

export class GteOperator {
	samplePolicy: ActivationSamplePolicy
	
	constructor(readonly condition: Condition, readonly argument: number) {
		this.samplePolicy = condition.samplePolicy;
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		return withDefaultCond(this.condition.filterGte(regions, this.argument, course, horse));
	}
}

export class AndOperator {
	samplePolicy: ActivationSamplePolicy

	constructor(readonly left: Operator, readonly right: Operator) {
		this.samplePolicy = left.samplePolicy.reconcile(right.samplePolicy);
	}

	apply(regions: RegionList, course: CourseData, horse: HorseParameters) {
		const [leftval, leftcond] = this.left.apply(regions, course, horse);
		const [rightval, rightcond] = this.right.apply(leftval, course, horse);
		if (leftcond === kTrue && rightcond === kTrue) {
			// avoid allocating an unnecessary closure object in the common case of no dynamic conditions
			return [rightval, kTrue] as [RegionList, DynamicCondition];
		}
		return [rightval, (s) => leftcond(s) && rightcond(s)] as [RegionList, DynamicCondition];
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
		const [leftval, leftcond] = this.left.apply(regions, course, horse);
		const [rightval, rightcond] = this.right.apply(regions, course, horse);
		// FIXME this is, technically, completely broken. really the correct way to do this is to tie dynamic conditions to regions
		// and propagate them during union and intersection. however, that's really annoying, and it turns out in practice that
		// dynamic conditions never actually change between branches of an or operator if the static conditions differ, in which case
		// this works out just fine. specifically, it's fine if /either/ the dynamic conditions differ or the static conditions differ
		// between branches, but not both.
		// eg, consider something like phase==0&accumulatetime>=20@phase==1&accumulatetime>=30
		// suppose phase 0 lasts 21 seconds, in which case the left branch would not trigger. the right branch then should not trigger
		// until 30 seconds, but this obviously does because it's broken. conditions like this do not currently appear on any skills.
		// unfortunately, there's not really a way here to assert that leftcond and rightcond are the same.
		// this is rather risky. i don't like it.
		// TODO actually, it's perfectly possible to just inspect the tree to make sure the above limitations are satisfied.
		return [leftval.union(rightval), (s) => leftcond(s) || rightcond(s)] as [RegionList, DynamicCondition];
	}
}

export interface Condition {
	samplePolicy: ActivationSamplePolicy
	filterEq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterNeq(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterLt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterLte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterGt(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
	filterGte(regions: RegionList, arg: number, course: CourseData, horse: HorseParameters): RegionList | [RegionList, DynamicCondition]
}

function notSupported(_0: RegionList, _1: number, _2: CourseData, _3: HorseParameters): never {
	assert(false, 'unsupported comparison');
	throw 0; // appease typescript
}

function noop(regions: RegionList, _1: number, _2: CourseData, _3: HorseParameters) {
	return regions;
}

const noopAll = Object.freeze({
	filterEq: noop,
	filterNeq: noop,
	filterLt: noop,
	filterLte: noop,
	filterGt: noop,
	filterGte: noop
});

const noopImmediate = Object.freeze(Object.assign({samplePolicy: ImmediatePolicy}, noopAll));
const noopRandom = Object.freeze(Object.assign({samplePolicy: RandomPolicy}, noopAll));

const defaultImmediate = Object.freeze({
	samplePolicy: ImmediatePolicy,
	filterEq: notSupported,
	filterNeq: notSupported,
	filterLt: notSupported,
	filterLte: notSupported,
	filterGt: notSupported,
	filterGte: notSupported
});

function immediate(o: Partial<Condition>) {
	return Object.assign({}, defaultImmediate, o);
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

function random(o: Partial<Condition>) {
	return Object.assign({}, defaultRandom, o);
}

// ive tried various things to make this return a [xRandom,noopXRandom] pair but seem to run into some typescript bugs
// or something
// it doesnt really make sense to me
function distributionRandomFactory<Ts extends unknown[]>(cls: new (...args: Ts) => DistributionRandomPolicy) {
	const cache = Object.create(null);
	return function (...args: [...clsArgs: Ts, o: Partial<Condition>]) {
		const o = args.pop();
		const key = args.join(',');
		// we know that after pop() args is just Ts but typescript doesn't, hence the cast
		const policy = key in cache ? cache[key] : (cache[key] = Object.freeze(new cls(...args as unknown as Ts)));
		return Object.assign({
			samplePolicy: policy,
			filterEq: notSupported,
			filterNeq: notSupported,
			filterLt: notSupported,
			filterLte: notSupported,
			filterGt: notSupported,
			filterGte: notSupported
		}, o);
	};
}

const logNormalRandom = distributionRandomFactory(LogNormalRandomPolicy);
const erlangRandom = distributionRandomFactory(ErlangRandomPolicy);
const uniformRandom = distributionRandomFactory(UniformRandomPolicy);

function noopLogNormalRandom(mu: number, sigma: number) {
	return logNormalRandom(mu, sigma, noopAll);
}

function noopErlangRandom(k: number, lambda: number) {
	return erlangRandom(k, lambda, noopAll);
}

const noopUniformRandom = uniformRandom(noopAll);

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
	accumulatetime: immediate({
		filterGte(regions: RegionList, t: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.accumulatetime >= t] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_all: immediate({
		filterLte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.activateCount.reduce((a,b) => a + b) <= n] as [RegionList, DynamicCondition];
		},
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.activateCount.reduce((a,b) => a + b) >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_end_after: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.activateCount[2] >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_heal: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.activateCountHeal >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_middle: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.activateCount[1] >= n] as [RegionList, DynamicCondition];
		}
	}),
	activate_count_start: immediate({
		filterGte(regions: RegionList, n: number, _0: CourseData, _1: HorseParameters) {
			return [regions, (s: RaceState) => s.activateCount[0] >= n] as [RegionList, DynamicCondition];
		}
	}),
	all_corner_random: {
		samplePolicy: AllCornerRandomPolicy,
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be all_corner_random==1');
			const corners = course.corners.map(c => new Region(c.start, c.start + c.length));
			return regions.rmap(r => corners.map(c => r.intersect(c)));
		},
		filterNeq: notSupported,
		filterLt: notSupported,
		filterLte: notSupported,
		filterGt: notSupported,
		filterGte: notSupported
	},
	always: noopImmediate,
	behind_near_lane_time: noopErlangRandom(3, 2.0),
	blocked_side_continuetime: noopErlangRandom(3, 2.0),
	change_order_onetime: noopErlangRandom(3, 2.0),
	compete_fight_count: uniformRandom({
		filterGt(regions: RegionList, _0: number, course: CourseData, _1: HorseParameters) {
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraight = course.straights[course.straights.length - 1];
			return regions.rmap(r => r.intersect(lastStraight));
		}
	}),
	corner: immediate({
		filterEq(regions: RegionList, cornerNum: number, course: CourseData, _: HorseParameters) {
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (cornerNum == 0) {
				// can't simply use straights here as there may be parts of a course which are neither corners nor straights
				let lastEnd = 0;
				const nonCorners = course.corners.map(c => {
					const r = new Region(lastEnd, c.start);
					lastEnd = c.start + c.length;
					return r;
				});
				if (lastEnd != course.distance) {
					nonCorners.push(new Region(lastEnd, course.distance));
				}
				return regions.rmap(r => nonCorners.map(s => r.intersect(s)));
			} else {
				const corner = course.corners[course.corners.length + cornerNum - 5];
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
	distance_diff_top: noopImmediate,
	distance_rate: immediate({
		filterGte(regions: RegionList, rate: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance * rate / 100, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	distance_rate_after_random: random({
		filterEq(regions: RegionList, rate: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance * rate / 100, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	distance_type: immediate({
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
	ground_condition: noopImmediate,  // TODO pass race conditions to filters
	ground_type: immediate({
		filterEq(regions: RegionList, surface: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsSurface(surface);
			return course.surface == surface ? regions : new RegionList();
		}
	}),
	// TODO in order to properly simulate skills that depend on hp_per this condition should pass a dynamic condition on to the
	// race solver. This is a bit more long-term since that would require simulating stamina, and therefore recoveries, and honestly
	// would be kind of a pain in general, and probably impossible to do accurately due to things like 位置取り争い that depend on other
	// umas, as well as random factors like downhill accel mode.
	// The only skill likely severely affected by this is Akebono's unique.
	hp_per: noopImmediate,
	infront_near_lane_time: noopErlangRandom(3, 2.0),
	is_finalcorner: immediate({
		filterEq(regions: RegionList, flag: number, course: CourseData, _: HorseParameters) {
			assert(flag == 0 || flag == 1, 'must be is_finalcorner==0 or is_finalcorner==1');
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length == 0) {
				return new RegionList();
			}
			const finalCornerStart = course.corners[course.corners.length - 1].start;
			const bounds = flag ? new Region(finalCornerStart, course.distance) : new Region(0, finalCornerStart);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_finalcorner_laterhalf: immediate({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_finalcorner_laterhalf==1');
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length == 0) {
				return new RegionList();
			}
			const fc = course.corners[course.corners.length - 1];
			const bounds = new Region((fc.start + fc.start + fc.length) / 2, fc.start + fc.length);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_finalcorner_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_finalcorner_random==1');
			assert(CourseHelpers.isSortedByStart(course.corners), 'course corners must be sorted by start');
			if (course.corners.length == 0) {
				return new RegionList();
			}
			const fc = course.corners[course.corners.length - 1];
			const bounds = new Region(fc.start, fc.start + fc.length);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_lastspurt: immediate({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_lastspurt==1');
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, 2), course.distance);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	is_last_straight_onetime: immediate({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be is_last_straight_onetime==1');
			assert(CourseHelpers.isSortedByStart(course.straights), 'course straights must be sorted by start');
			const lastStraightStart = course.straights[course.straights.length - 1].start;
			// TODO ask kuromi about this or something
			const trigger = new Region(lastStraightStart, lastStraightStart + 10);
			return regions.rmap(r => r.intersect(trigger));
		}
	}),
	is_move_lane: noopErlangRandom(5, 1.0),
	is_surrounded: noopErlangRandom(3, 2.0),
	near_count: noopErlangRandom(3, 2.0),
	order: noopImmediate,
	order_rate: noopImmediate,
	order_rate_in20_continue: noopImmediate,
	order_rate_in40_continue: noopImmediate,
	order_rate_out40_continue: noopImmediate,
	order_rate_out50_continue: noopImmediate,
	order_rate_out70_continue: noopImmediate,
	phase: {
		samplePolicy: ImmediatePolicy,
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
	phase_laterhalf_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const start = CourseHelpers.phaseStart(course.distance, phase);
			const end = CourseHelpers.phaseEnd(course.distance, phase);
			const bounds = new Region((start + end) / 2, end);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	phase_random: random({
		filterEq(regions: RegionList, phase: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsPhase(phase);
			const bounds = new Region(CourseHelpers.phaseStart(course.distance, phase), CourseHelpers.phaseEnd(course.distance, phase));
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	remain_distance: immediate({
		filterLte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(course.distance - remain, course.distance);
			return regions.rmap(r => r.intersect(bounds));
		},
		filterGte(regions: RegionList, remain: number, course: CourseData, _: HorseParameters) {
			const bounds = new Region(0, course.distance - remain);
			return regions.rmap(r => r.intersect(bounds));
		}
	}),
	rotation: immediate({
		filterEq(regions: RegionList, rotation: number, course: CourseData, _: HorseParameters) {
			CourseHelpers.assertIsOrientation(rotation);
			return course.turn == rotation ? regions : new RegionList();
		}
	}),
	running_style: immediate({
		filterEq(regions: RegionList, strategy: number, _: CourseData, horse: HorseParameters) {
			StrategyHelpers.assertIsStrategy(strategy);
			if (StrategyHelpers.strategyMatches(horse.strategy, strategy)) {
				return regions;
			} else {
				return new RegionList();
			}
		}
	}),
	season: noopImmediate,  // TODO pass race conditions to filters
	slope: immediate({
		filterEq(regions: RegionList, slopeType: number, course: CourseData, _: HorseParameters) {
			assert(slopeType == 0 || slopeType == 1 || slopeType == 2, 'slopeType');
			// Requires course.slopes is sorted by slope start— this is not always the case, since in course_data.json they are
			// (sometimes?) sorted first by uphill/downhill and then by start. They should be sorted when the course is loaded.
			assert(CourseHelpers.isSortedByStart(course.slopes), 'course slopes must be sorted by slope start');
			let lastEnd = 0;
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
	straight_random: {
		samplePolicy: StraightRandomPolicy,
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be straight_random==1');
			return regions.rmap(r => course.straights.map(s => r.intersect(s)));
		},
		filterNeq: notSupported,
		filterLt: notSupported,
		filterLte: notSupported,
		filterGt: notSupported,
		filterGte: notSupported
	},
	temptation_count: noopImmediate,
	up_slope_random: random({
		filterEq(regions: RegionList, one: number, course: CourseData, _: HorseParameters) {
			assert(one == 1, 'must be up_slope_random==1');
			const slopes = course.slopes.filter(s => s.slope > 0).map(s => new Region(s.start, s.start + s.length));
			return regions.rmap(r => slopes.map(s => r.intersect(s)));
		}
	}),
	weather: noopImmediate  // TODO pass race conditions to filters
});
