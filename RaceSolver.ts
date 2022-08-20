const assert = require('assert').strict;

import { Strategy, Aptitude, HorseParameters } from './HorseTypes';
import { CourseData, CourseHelpers, Phase } from './CourseData';
import { Region } from './Region';

namespace Speed {
	export const StrategyPhaseCoefficient = Object.freeze([
		[], // strategies start numbered at 1
		[1.0, 0.98, 0.962],
		[0.978, 0.991, 0.975],
		[0.938, 0.998, 0.994],
		[0.931, 1.0, 1.0],
		[1.063, 0.962, 0.95]
	].map(a => Object.freeze(a)));
	export const DistanceProficiencyModifier = Object.freeze([1.05, 1.0, 0.9, 0.8, 0.6, 0.4, 0.2, 0.1]);
}

function baseSpeed(course: CourseData) {
	return 20.0 - (course.distance - 2000) / 1000;
}

function baseTargetSpeed(horse: HorseParameters, course: CourseData, phase: Phase) {
	return baseSpeed(course) * Speed.StrategyPhaseCoefficient[horse.strategy][phase] +
		+(phase == 2) * Math.sqrt(500.0 * horse.speed) *
		Speed.DistanceProficiencyModifier[horse.distanceAptitude] *
		0.002;
}

function lastSpurtSpeed(horse: HorseParameters, course: CourseData) {
	return (baseTargetSpeed(horse, course, 2) + 0.01 * baseSpeed(course)) * 1.05 +
		Math.sqrt(500.0 * horse.speed) * Speed.DistanceProficiencyModifier[horse.distanceAptitude] * 0.002 +
		Math.pow(450.0 * horse.guts, 0.597) * 0.0001;
}

namespace Acceleration {
	export const StrategyPhaseCoefficient = Object.freeze([
		[],
		[1.0, 1.0, 0.996],
		[0.985, 1.0, 0.996],
		[0.975, 1.0, 1.0],
		[0.945, 1.0, 0.997],
		[1.17, 0.94, 0.956]
	].map(a => Object.freeze(a)));
	export const GroundTypeProficiencyModifier = Object.freeze([1.05, 1.0, 0.9, 0.8, 0.7, 0.5, 0.3, 0.1]);
	export const DistanceProficiencyModifier = Object.freeze([1.0, 1.0, 1.0, 1.0, 1.0, 0.6, 0.5, 0.4]);
}

const BaseAccel = 0.0006;
const UphillBaseAccel = 0.0004;

function baseAccel(baseAccel: number, horse: HorseParameters, phase: Phase) {
	return baseAccel * Math.sqrt(500.0 * horse.power) *
	  Acceleration.StrategyPhaseCoefficient[horse.strategy][phase] *
	  Acceleration.GroundTypeProficiencyModifier[horse.surfaceAptitude] *
	  Acceleration.DistanceProficiencyModifier[horse.distanceAptitude];
}

function decel(pos: number, distance: number) {
	if (pos >= distance * 2/3) return -1.0;
	else if (pos >= distance * 1/6) return -0.8;
	else return -1.2;
}

export interface RaceState {
	readonly accumulatetime: number
	readonly activateCount: readonly number[]
	readonly activateCountHeal: number
}

export type DynamicCondition = (state: RaceState) => boolean;

export const enum SkillType { TargetSpeed, Accel, CurrentSpeed, Recovery, ActivateRandomGold }

export const enum SkillRarity { White = 1, Gold, Unique }

export interface SkillEffect {
	type: SkillType
	baseDuration: number
	modifier: number
}

export interface PendingSkill {
	skillId: string
	rarity: SkillRarity
	trigger: Region
	extraCondition: DynamicCondition
	effects: SkillEffect[]
}

interface ActiveSkill {
	skillId: string
	remainingDuration: number
	modifier: number
}

export class RaceSolver {
	accumulatetime: number
	pos: number
	minSpeed: number
	currentSpeed: number
	targetSpeed: number
	accel: number
	horse: HorseParameters
	course: CourseData
	startDash: boolean
	phase: Phase
	nextPhaseTransition: number
	activeSpeedSkills: ActiveSkill[]
	activeAccelSkills: ActiveSkill[]
	pendingSkills: PendingSkill[]
	currentSpeedModifier: number
	nHills: number
	hillIdx: number
	hillStart: number[]
	hillEnd: number[]
	activateCount: number[]
	activateCountHeal: number
	onSkillActivate: (s: string) => void
	onSkillDeactivate: (s: string) => void

	constructor(horse: HorseParameters, course: CourseData) {
		this.horse = horse;
		this.course = course;
		this.accumulatetime = 0.0;
		this.phase = 0;
		this.nextPhaseTransition = CourseHelpers.phaseStart(course.distance, 1);
		this.pos = 0.0;
		this.accel = 0.0;
		this.currentSpeed = 0.0;
		this.targetSpeed = 0.85 * baseSpeed(course);
		this.minSpeed = this.targetSpeed + Math.sqrt(200.0 * horse.guts) * 0.001;
		this.startDash = true;
		this.activeSpeedSkills = [];
		this.activeAccelSkills = [];
		this.pendingSkills = [];
		this.currentSpeedModifier = 0.0;
		this.activateCount = [0,0,0];
		this.activateCountHeal = 0;
		this.onSkillActivate = () => {}
		this.onSkillDeactivate = () => {}
		this.initHills();
	}

	initHills() {
		// note that slopes are not always sorted by start location in course_data.json
		// sometimes (?) they are sorted by hill type and then by start
		// require this here because the code relies on encountering them sequentially
		assert(CourseHelpers.isSortedByStart(this.course.slopes), 'slopes must be sorted by start location');

		this.nHills = this.course.slopes.length;
		this.hillStart = this.course.slopes.map(s => s.start).reverse();
		this.hillEnd = this.course.slopes.map(s => s.start + s.length).reverse();
		this.hillIdx = -1;
		if (this.hillStart.length > 0 && this.hillStart[this.hillStart.length - 1] == 0) {
			if (this.course.slopes[0].slope > 0) {
				this.hillIdx = 0;
			} else {
				this.hillEnd.pop();
			}
			this.hillStart.pop();
		}
	}

	step(dt: number) {
		// velocity verlet integration
		// do this half-step update of velocity (halfv) because during the start dash acceleration depends on velocity
		// (ie, velocity is given by the following system of differential equations)
		//
		// x′(t) = x′(t - Δt) + Δt * x′′(t)
		//          ⎧ baseAccel(horse) + accelSkillModifier + 24.0	if x′(t) < 0.85 * baseSpeed(course)
		// x′′(t) = ⎨
		//          ⎩ baseAccel(horse) + accelSkillModifier			if x′(t) ≥ 0.85 * baseSpeed(course)
		//
		// i dont actually know anything about numerical analysis but i saw this on the internet

		let targetSpeed = this.currentSpeed > this.targetSpeed ? 9999 : this.targetSpeed;  // allow decelerating if targetSpeed drops
		const halfv = Math.min(this.currentSpeed + 0.5 * dt * this.accel, targetSpeed);
		this.pos += halfv * dt;
		this.accumulatetime += dt;
		this.updateHills();
		this.updatePhase();
		this.processSkillActivations(dt);
		this.updateTargetSpeed();
		this.applyForces();
		targetSpeed = this.currentSpeed > this.targetSpeed ? 9999 : this.targetSpeed;
		this.currentSpeed = Math.min(halfv + 0.5 * dt * this.accel + this.currentSpeedModifier, targetSpeed);
		if (!this.startDash && this.currentSpeed < this.minSpeed) {
			this.currentSpeed = this.minSpeed;
		}
		this.currentSpeedModifier = 0.0;
	}

	updateTargetSpeed() {
		if (this.phase == 2) {
			this.targetSpeed = lastSpurtSpeed(this.horse, this.course);
		} else if (!this.startDash) {
			this.targetSpeed = baseTargetSpeed(this.horse, this.course, this.phase);
		}
		if (!this.startDash) {
			this.targetSpeed += this.activeSpeedSkills.reduce((a,b) => a + b.modifier, 0);
		}
		if (this.hillIdx != -1) {
			this.targetSpeed -= this.course.slopes[this.hillIdx].slope / 10000 * 200 / this.horse.power;
		}
	}

	applyForces() {
		if (this.currentSpeed > this.targetSpeed) {
			this.accel = decel(this.pos, this.course.distance);
			return;
		}
		this.accel = baseAccel(this.hillIdx != -1 ? UphillBaseAccel : BaseAccel, this.horse, this.phase);
		if (this.startDash && this.currentSpeed >= this.targetSpeed) {
			this.startDash = false;
		}
		if (this.startDash) {
			this.accel += 24.0;
		}
		this.accel += this.activeAccelSkills.reduce((a,b) => a + b.modifier, 0);
	}

	updateHills() {
		if (this.hillIdx == -1 && this.hillStart.length > 0 && this.pos >= this.hillStart[this.hillStart.length - 1]) {
			if (this.course.slopes[this.nHills - this.hillStart.length].slope > 0) {
				this.hillIdx = this.nHills - this.hillStart.length;
			} else {
				this.hillEnd.pop();
			}
			this.hillStart.pop();
		} else if (this.hillIdx != -1 && this.hillEnd.length > 0 && this.pos > this.hillEnd[this.hillEnd.length - 1]) {
			this.hillIdx = -1;
			this.hillEnd.pop();
		}
	}

	updatePhase() {
		// NB. there is actually a phase 3 which starts at 5/6 distance, but for purposes of
		// strategy phase modifiers, activate_count_end_after, etc it is the same as phase 2
		// and it's easier to treat them together, so cap phase at 2.
		if (this.pos >= this.nextPhaseTransition && this.phase < 2) {
			++this.phase;
			this.nextPhaseTransition = CourseHelpers.phaseStart(this.course.distance, this.phase + 1 as Phase);
		}
	}

	processSkillActivations(dt: number) {
		for (let i = this.activeSpeedSkills.length; --i >= 0;) {
			const s = this.activeSpeedSkills[i];
			if ((s.remainingDuration -= dt) <= 0) {
				this.activeSpeedSkills.splice(i,1);
				this.onSkillDeactivate(s.skillId);
			}
		}
		for (let i = this.activeAccelSkills.length; --i >= 0;) {
			const s = this.activeAccelSkills[i];
			if ((s.remainingDuration -= dt) <= 0) {
				this.activeAccelSkills.splice(i,1);
				this.onSkillDeactivate(s.skillId);
			}
		}
		for (let i = this.pendingSkills.length; --i >= 0;) {
			const s = this.pendingSkills[i];
			if (this.pos >= s.trigger.end) {  // NB. `Region`s are half-open [start,end) intervals. If pos == end we are out of the trigger.
				// skill failed to activate
				this.pendingSkills.splice(i,1);
			} else if (this.pos >= s.trigger.start && s.extraCondition(this)) {
				this.activateSkill(s);
				this.pendingSkills.splice(i,1);
			}
		}
	}

	activateSkill(s: PendingSkill) {
		s.effects.forEach(ef => {
			const scaledDuration = ef.baseDuration * this.course.distance / 1000;
			switch (ef.type) {
			case SkillType.TargetSpeed:
				this.activeSpeedSkills.push({skillId: s.skillId, remainingDuration: scaledDuration, modifier: ef.modifier});
				break;
			case SkillType.Accel:
				this.activeAccelSkills.push({skillId: s.skillId, remainingDuration: scaledDuration, modifier: ef.modifier});
				break;
			case SkillType.CurrentSpeed:
				this.currentSpeedModifier += ef.modifier;
				break;
			case SkillType.Recovery:
				++this.activateCountHeal;
				break;
			case SkillType.ActivateRandomGold:
				this.doActivateRandomGold(ef.modifier);
				break;
			}
		});
		++this.activateCount[this.phase];
		this.onSkillActivate(s.skillId);
	}

	doActivateRandomGold(ngolds: number) {
		const goldIndices = this.pendingSkills.reduce((acc, skill, i) => {
			if (skill.rarity == SkillRarity.Gold) acc.push(i);
			return acc;
		}, []);
		for (let i = goldIndices.length; --i >= 0;) {
			const j = Math.floor(Math.random() * (i + 1));
			[goldIndices[i], goldIndices[j]] = [goldIndices[j], goldIndices[i]];
		}
		for (let i = 0; i < Math.min(ngolds, goldIndices.length); ++i) {
			this.activateSkill(this.pendingSkills[goldIndices[i]]);
			// important: we can't actually remove this from pendingSkills directly, since this function runs inside the loop in
			// processSkillActivations. modifying the pendingSkills array here would mess up that loop. instead, by setting its
			// trigger to 0, we ensure that the skill won't activate again and will be cleaned up either later in the loop or
			// the next time processSkillActivations is called.
			// this is a bit of a hack and i don't like it very much
			// NB. this mutation could be visible outside of RaceSolver, since the caller constructs the initial PendingSkill
			// objects and sets their triggers. currently, that doesn't matter since nothing uses them after the solver runs,
			// but it should be assumed by callers that once added to pendingSkills RaceSolver owns the skill object and the
			// caller shouldn't rely on it being the same.
			// this means, for example, the same PendingSkill object can't be added to two different RaceSolvers
			// frankly this seems exceptionally error-prone and i'm sure it's going to bite me with some hard-to-diagnose bug
			// at some point. TODO find a better way to deal with this
			this.pendingSkills[goldIndices[i]].trigger = new Region(0,0);
		}
	}
}
