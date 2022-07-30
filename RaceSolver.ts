const assert = require('assert').strict;

import { Strategy, Aptitude, HorseParameters } from './HorseTypes';
import { CourseData, CourseHelpers, Phase } from './CourseData';
import { Region } from './ActivationConditions';

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
}

export type DynamicCondition = (state: RaceState) => boolean;

export const enum SkillType { TargetSpeed, Accel, CurrentSpeed }

export interface SkillEffect {
	skillId: string
	type: SkillType
	baseDuration: number
	modifier: number
}

export interface PendingSkill {
	trigger: Region
	extraCondition: DynamicCondition
	effect: SkillEffect
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
	activeSpeedSkills: {remainingDuration: number, effect: SkillEffect}[]
	activeAccelSkills: {remainingDuration: number, effect: SkillEffect}[]
	pendingSkills: PendingSkill[]
	currentSpeedModifier: number
	nHills: number
	hillIdx: number
	hillStart: number[]
	hillEnd: number[]
	onSkillActivate: (s: SkillEffect) => void
	onSkillDeactivate: (s: SkillEffect) => void

	constructor(horse: HorseParameters, course: CourseData) {
		this.horse = horse;
		this.course = course;
		this.accumulatetime = 0.0;
		this.phase = 0;
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
		this.processSkillActivations(dt);
		this.updateTargetSpeed();
		this.applyForces();
		targetSpeed = this.currentSpeed > this.targetSpeed ? 9999 : this.targetSpeed;
		this.currentSpeed = Math.min(halfv + 0.5 * dt * this.accel + this.currentSpeedModifier, targetSpeed);
		if (!this.startDash && this.currentSpeed < this.minSpeed) {
			this.currentSpeed = this.minSpeed;
		}
		if (this.pos >= this.course.distance * 2/3) {
			// NB. there is actually a phase 3 which starts at 5/6 distance, but for purposes of
			// strategy phase modifiers etc it is the same as phase 2 so don't bother with it here
			this.phase = 2;
		} else if (this.pos >= this.course.distance * 1/6) {
			this.phase = 1;
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
			this.targetSpeed += this.activeSpeedSkills.reduce((a,b) => a + b.effect.modifier, 0);
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
		this.accel += this.activeAccelSkills.reduce((a,b) => a + b.effect.modifier, 0);
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

	processSkillActivations(dt: number) {
		for (var i = this.activeSpeedSkills.length; --i >= 0;) {
			const s = this.activeSpeedSkills[i];
			if ((s.remainingDuration -= dt) <= 0) {
				this.activeSpeedSkills.splice(i,1);
				this.onSkillDeactivate(s.effect);
			}
		}
		for (var i = this.activeAccelSkills.length; --i >= 0;) {
			const s = this.activeAccelSkills[i];
			if ((s.remainingDuration -= dt) <= 0) {
				this.activeAccelSkills.splice(i,1);
				this.onSkillDeactivate(s.effect);
			}
		}
		for (var i = this.pendingSkills.length; --i >= 0;) {
			const s = this.pendingSkills[i];
			if (this.pos >= s.trigger.end) { // NB. `Region`s are half-open [start,end) intervals. If pos == end we are out of the trigger.
				// skill failed to activate
				this.pendingSkills.splice(i,1);
			} else if (this.pos >= s.trigger.start && s.extraCondition(this)) {
				const scaledDuration = s.effect.baseDuration * this.course.distance / 1000;
				switch (s.effect.type) {
				case SkillType.TargetSpeed:
					this.activeSpeedSkills.push({remainingDuration: scaledDuration, effect: s.effect});
					break;
				case SkillType.Accel:
					this.activeAccelSkills.push({remainingDuration: scaledDuration, effect: s.effect});
					break;
				case SkillType.CurrentSpeed:
					this.currentSpeedModifier += s.effect.modifier;
					break;
				}
				this.onSkillActivate(s.effect);
				this.pendingSkills.splice(i,1);
			}
		}
	}
}
