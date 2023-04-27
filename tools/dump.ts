import { Option } from 'commander';
import { HorseParameters } from '../HorseTypes';
import { CourseData } from '../CourseData';
import { RaceSolver } from '../RaceSolver';
import { Rule30CARng } from '../Random';
import { SkillData, ToolCLI, PacerProvider } from './ToolCLI';

// for some reason (NodeJS bug?) new Int32Array(buf.buffer)[offset] doesn't actually work and the Int32Array is garbage
// more weirdly, it only happens when loading cliOptions.configuration down there, and running the exact same thing in the NodeJS REPL works fine
// so yeah, i dunno
function readInt32LE(buf: Buffer, offset: number) {
	return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24);
}

const cli = new ToolCLI();
cli.options(program => {
	program
		.option('--seed <seed>', 'seed value for pseudorandom number generator', (value,_) => parseInt(value,10) >>> 0)
		.addOption(new Option('-C, --configuration <confstring>')
			.conflicts('seed')
			.argParser(s => Buffer.from(s, 'base64'))
		);
});
cli.run((horse: HorseParameters, course: CourseData, defSkills: SkillData[], cliSkills: SkillData[], getPacer: PacerProvider, cliOptions: any) => {
	let seed, nsamples = 1, sampleIdx = 0, solverSeedHi, solverSeedLo, pacerSeedHi, pacerSeedLo;
	if ('seed' in cliOptions) {
		seed = cliOptions.seed;
	} else if ('configuration' in cliOptions) {
		const conf = cliOptions.configuration;
		seed = readInt32LE(conf, 0) >>> 0;
		nsamples = readInt32LE(conf, 4);
		sampleIdx = readInt32LE(conf, 8);
		solverSeedHi = readInt32LE(conf, 12) >>> 0;
		solverSeedLo = readInt32LE(conf, 16) >>> 0;
		pacerSeedHi = readInt32LE(conf, 20) >>> 0;
		pacerSeedLo = readInt32LE(conf, 24) >>> 0;
	} else {
		seed = Math.floor(Math.random() * (-1 >>> 0)) >>> 0;
	}
	const rng = new Rule30CARng(seed);
	if (solverSeedHi == undefined) {
		solverSeedHi = 0;
		solverSeedLo = rng.int32();
		pacerSeedHi = 0;
		pacerSeedLo = rng.int32();
	}
	const solverRng = new Rule30CARng(solverSeedLo, solverSeedHi);
	const pacerRng = new Rule30CARng(pacerSeedLo, pacerSeedHi);

	const skillTypes = {};
	const skills = [];
	function addSkill(sd: SkillData) {
		skillTypes[sd.skillId] = sd.effects[0].type;
		const triggers = sd.samplePolicy.sample(sd.regions, nsamples, rng);
		skills.push({
			skillId: sd.skillId,
			rarity: sd.rarity,
			trigger: triggers[sampleIdx % triggers.length],
			extraCondition: sd.extraCondition,
			effects: sd.effects
		});
	}

	defSkills.forEach(addSkill);
	cliSkills.forEach(addSkill);

	const plotData = {trackId: course.raceTrackId, courseId: cliOptions.course, t: [0], pos: [0], v: [], targetv: [], a: [], skills: {}};

	const s = new RaceSolver({
		horse, course, skills,
		pacer: getPacer(pacerRng),
		rng: solverRng,
		onSkillActivate: (s,skillId) => {
			plotData.skills[skillId] = [skillTypes[skillId],s.accumulatetime.t,0,s.pos,0];
		},
		onSkillDeactivate: (s,skillId) => {
			plotData.skills[skillId][2] = s.accumulatetime.t;
			plotData.skills[skillId][4] = s.pos;
		}
	});
	plotData.v.push(s.currentSpeed);
	plotData.targetv.push(s.targetSpeed);
	plotData.a.push(s.accel);

	let paceDownN = 0;
	let paceDownToggle = false;
	const dt = cliOptions.timestep;
	while (s.pos < course.distance) {
		s.step(dt);
		plotData.t.push(s.accumulatetime.t);
		plotData.pos.push(s.pos);
		plotData.v.push(s.currentSpeed + s.modifiers.currentSpeed.acc + s.modifiers.currentSpeed.err);
		plotData.targetv.push(s.targetSpeed);
		plotData.a.push(s.accel);
		if (s.isPaceDown != paceDownToggle) {
			const k = 'pd' + paceDownN;
			if (plotData.skills[k] && plotData.skills[k][2] == 0) {
				plotData.skills[k][2] = s.accumulatetime.t;
				plotData.skills[k][4] = s.pos;
				++paceDownN;
			} else {
				plotData.skills[k] = [-1,s.accumulatetime.t,0,s.pos,0];
			}
			paceDownToggle = s.isPaceDown;
		}
	}

	// clean up skills that haven't deactivated by the end of the race
	Object.keys(plotData.skills).forEach(sk => {
		if (plotData.skills[sk][2] == 0) {
			plotData.skills[sk][2] = s.accumulatetime.t;
			plotData.skills[sk][4] = s.pos;
		}
	});

	console.log(JSON.stringify(plotData));
});
