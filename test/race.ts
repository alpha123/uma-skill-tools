import { program, Option } from 'commander';
import * as fc from 'fast-check';
import { prop, forAll } from './TestHelpers';
import * as arb from './arb/Race';

import { RaceSolver } from '../RaceSolver';

program
	.addOption(new Option('-n, --runs <number>', 'number of runs per property')
		.default(10000)
		.argParser(n => parseInt(n,10)))
	.addOption(new Option('--timestep <dt>', 'integration timestep in seconds')
		.default(1/15, '1/15')
		.argParser(ts => ts.split('/').reduceRight((a,b) => +b / +a, 1.0)));

program.parse();
const options = program.opts();

fc.configureGlobal({numRuns: options.runs});
prop('race should always progress forward', forAll(arb.Race(), params => {
	const builder = arb.makeBuilder(params);
	const g = builder.build();

	for (let i = 0; i < params.nsamples; ++i) {
		const s = g.next().value as RaceSolver;
		let lastPos = 0;
		while (s.pos < builder._course.distance) {
			s.step(options.timestep);
			if (s.pos <= lastPos) {
				return false;
			}
			lastPos = s.pos;
		}
	}

	return true;
}));

prop('position should always be defined', forAll(arb.Race(), params => {
	const builder = arb.makeBuilder(params);
	const g = builder.build();

	for (let i = 0; i < params.nsamples; ++i) {
		const s = g.next().value as RaceSolver;
		while (s.pos < builder._course.distance) {
			s.step(options.timestep);
			if (isNaN(s.pos)) {
				return false;
			}
		}
	}
	return true;
}));

prop('identical race solvers should always stay in sync', forAll(arb.Race(), params => {
	const b1 = arb.makeBuilder(params);
	const b2 = b1.fork();
	const g1 = b1.build();
	const g2 = b2.build();

	for (let i = 0; i < params.nsamples; ++i) {
		const s1 = g1.next().value as RaceSolver;
		const s2 = g2.next().value as RaceSolver;

		while (s1.pos < b1._course.distance) {
			s1.step(options.timestep);
			s2.step(options.timestep);
			if (s1.pos != s2.pos) {
				return false;
			}
		}
	}
	return true;
}));
