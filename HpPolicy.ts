import type { RaceState } from './RaceSolver';
import { HorseParameters } from './HorseTypes';
import { CourseData, CourseHelpers, Phase } from './CourseData';
import { GroundCondition } from './RaceParameters';
import { Rule30CARng } from './Random';

export interface HpPolicy {
	tick(state: RaceState, dt: number): void
	hasRemainingHp(): boolean
	recover(modifier: number): void
	getLastSpurtPair(state: RaceState, maxSpeed: number, baseTargetSpeed2: number): [number, number]
}

export class NoopHpPolicy {
	phase2Start: number
	constructor(course: CourseData) {
		this.phase2Start = CourseHelpers.phaseStart(course.distance, 2);
	}

	tick(_0: RaceState, _1: number) {}
	hasRemainingHp() { return true; }
	recover(_: number) {}
	getLastSpurtPair(_0: RaceState, maxSpeed: number, _1: number) { return [this.phase2Start, maxSpeed] as [number, number]; }
}

const HpStrategyCoefficient = Object.freeze([0, 0.95, 0.89, 1.0, 0.995, 0.86]);
const HpConsumptionGroundModifier = Object.freeze([
	[],
	[0, 1.0, 1.0, 1.02, 1.02],
	[0, 1.0, 1.0, 1.01, 1.02]
].map(o => Object.freeze(o)));

export class GameHpPolicy {
	distance: number
	baseSpeed: number
	maxHp: number
	hp: number
	groundModifier: number
	gutsModifier: number
	subparAcceptChance: number
	rng: Rule30CARng

	constructor(horse: HorseParameters, course: CourseData, ground: GroundCondition, seed: number) {
		this.distance = course.distance;
		this.baseSpeed = 20.0 - (course.distance - 2000) / 1000.0;
		this.maxHp = 0.8 * HpStrategyCoefficient[horse.strategy] * horse.stamina + course.distance;
		this.hp = this.maxHp;
		this.groundModifier = HpConsumptionGroundModifier[course.surface][ground];
		this.gutsModifier = 1.0 + 200.0 / Math.sqrt(600.0 * horse.guts);
		this.subparAcceptChance = Math.round((15.0 + 0.05 * horse.wisdom) * 1000);
		this.rng = new Rule30CARng(seed);
	}

	getStatusModifier(state: {isPaceDown: boolean}) {
		let modifier = 1.0;
		if (state.isPaceDown) {
			modifier *= 0.6;
		}
		// TODO downhill mode
		return modifier;
	}

	hpPerSecond(state: {phase: Phase, isPaceDown: boolean}, velocity: number) {
		const gutsModifier = state.phase >= 2 ? this.gutsModifier : 1.0;
		return 20.0 * Math.pow(velocity - this.baseSpeed + 12.0, 2) / 144.0 *
			this.getStatusModifier(state) * this.groundModifier * gutsModifier;
	}

	tick(state: RaceState, dt: number) {
		// NOTE unsure whether hp is consumed by `amount*dt` per frame or `amount` once every second
		// i think it is actually the latter
		this.hp -= this.hpPerSecond(state, state.currentSpeed) * dt;
	}

	hasRemainingHp() {
		return this.hp > 0.0;
	}

	recover(modifier: number) {
		this.hp = Math.min(this.maxHp, this.hp + this.maxHp * modifier);
	}

	getLastSpurtPair(state: RaceState, maxSpeed: number, baseTargetSpeed2: number) {
		const maxDist = this.distance - CourseHelpers.phaseStart(this.distance, 2);
		const s = (maxDist - 60) / maxSpeed;
		const lastleg = {phase: 2 as Phase, isPaceDown: false};
		if (this.hp >= this.hpPerSecond(lastleg, maxSpeed) * s) {
			return [maxDist, maxSpeed] as [number, number];
		}
		const candidates: [number, number][] = [];
		const remainDistance = this.distance - 60 - state.pos;
		const statusModifier = this.getStatusModifier(lastleg);
		for (let speed = maxSpeed - 0.1; speed >= baseTargetSpeed2; speed -= 0.1) {
			// solve `hpForDistance(d, speed) + hpForDistance(remainDistance - d, baseTargetSpeed2) == this.hp` for `d`
			const spurtDist = Math.min(remainDistance, Math.max(0, 0.2 * speed *
				(36.0 * baseTargetSpeed2 * this.hp - 720.0 * this.groundModifier * this.gutsModifier * remainDistance * statusModifier *
   					Math.pow((-this.baseSpeed + baseTargetSpeed2) / 12.0 + 1, 2))
   				/
   				(this.groundModifier * this.gutsModifier * statusModifier *
   					(144.0 * baseTargetSpeed2 * Math.pow((-this.baseSpeed + speed) / 12.0 + 1, 2) -
   						144.0 * speed * Math.pow((-this.baseSpeed + baseTargetSpeed2) / 12.0 + 1, 2)))));
   			candidates.push([this.distance - spurtDist, speed]);
		}
		candidates.sort((a,b) =>
			((a[0] - state.pos) / baseTargetSpeed2 + (this.distance - a[0]) / a[1]) -
			((b[0] - state.pos) / baseTargetSpeed2 + (this.distance - b[0]) / b[1]));
		for (let i = 0; i < candidates.length; ++i) {
			if (this.rng.uniform(100000) <= this.subparAcceptChance) {
				return candidates[i];
			}
		}
		return candidates[candidates.length-1];
	}
}
