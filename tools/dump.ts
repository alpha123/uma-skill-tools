import { HorseParameters } from '../HorseTypes';
import { CourseData } from '../CourseData';
import { RaceSolver } from '../RaceSolver';
import { Rule30CARng } from '../Random';
import { SkillData, ToolCLI, PacerProvider } from './ToolCLI';

const cli = new ToolCLI();
cli.options(program => {
	program.option('--seed <seed>', 'seed value for pseudorandom number generator', (value,_) => parseInt(value,10) >>> 0);
});
cli.run((horse: HorseParameters, course: CourseData, defSkills: SkillData[], cliSkills: SkillData[], getPacer: PacerProvider, cliOptions: any) => {
	const rng = new Rule30CARng('seed' in cliOptions ? cliOptions.seed : Math.floor(Math.random() * (-1 >>> 0)));
	const solverRng = new Rule30CARng(rng.int32());
	const pacerRng = new Rule30CARng(rng.int32());

	const s = new RaceSolver({horse, course, pacer: getPacer(pacerRng), rng: solverRng});
	const skillTypes = {};

	function addSkill(sd: SkillData) {
		skillTypes[sd.skillId] = sd.effects[0].type;
		s.pendingSkills.push({
			skillId: sd.skillId,
			rarity: sd.rarity,
			trigger: sd.samplePolicy.sample(sd.regions, 1, rng)[0],
			extraCondition: sd.extraCondition,
			effects: sd.effects
		});
	}

	defSkills.forEach(addSkill);
	cliSkills.forEach(addSkill);

	const plotData = {trackId: course.raceTrackId, courseId: cliOptions.course, t: [0], pos: [0], v: [0], targetv: [s.targetSpeed], a: [0], skills: {}};

	s.onSkillActivate = (skillId) => { plotData.skills[skillId] = [skillTypes[skillId],s.accumulatetime,0,s.pos,0]; }
	s.onSkillDeactivate = (skillId) => {
		plotData.skills[skillId][2] = s.accumulatetime;
		plotData.skills[skillId][4] = s.pos;
	}

	let paceDownN = 0;
	let paceDownToggle = false;
	while (s.pos < course.distance) {
		s.step(1/60);
		plotData.t.push(s.accumulatetime);
		plotData.pos.push(s.pos);
		plotData.v.push(s.currentSpeed);
		plotData.targetv.push(s.targetSpeed);
		plotData.a.push(s.accel);
		if (s.isPaceDown != paceDownToggle) {
			const k = 'pd' + paceDownN;
			if (plotData.skills[k] && plotData.skills[k][2] == 0) {
				plotData.skills[k][2] = s.accumulatetime;
				plotData.skills[k][4] = s.pos;
				++paceDownN;
			} else {
				plotData.skills[k] = [-1,s.accumulatetime,0,s.pos,0];
			}
			paceDownToggle = s.isPaceDown;
		}
	}

	// clean up skills that haven't deactivated by the end of the race
	Object.keys(plotData.skills).forEach(sk => {
		if (plotData.skills[sk][2] == 0) {
			plotData.skills[sk][2] = s.accumulatetime;
			plotData.skills[sk][4] = s.pos;
		}
	});

	console.log(JSON.stringify(plotData));
});
