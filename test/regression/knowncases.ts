import test from 'tape';

import { makeBuilder, RaceParams } from '../arb/Race';
import { RaceSolver } from '../../RaceSolver';

const cases = [
	{"seed":-1270488283,"courseId":'10815',"groundCondition":1,"mood":2,"horse":{ "speed":7,"stamina":4,"power":2,"guts":3,"wisdom":1995,"strategy":"Oikomi","distanceAptitude":"F","surfaceAptitude":"D","strategyAptitude":"F"},"paceEffectsEnabled":false,"nsamples":609,"presupposedSkills":["201382","201173","100651","110181","202481","120131","900101","200241","900601"],"skillsUnderTest":["201671","201121","202011"]},
	{"seed":0,"courseId":"10205","groundCondition":0,"mood":-2,"horse":{"speed":1,"stamina":1,"power":1,"guts":1,"wisdom":1,"strategy":"Oonige","distanceAptitude":"S","surfaceAptitude":"S","strategyAptitude":"S"},"paceEffectsEnabled":false,"nsamples":1,"presupposedSkills":[],"skillsUnderTest":[]},
	{"seed":0,"courseId":"10301","groundCondition":0,"mood":-2,"horse":{"speed":1,"stamina":1,"power":1,"guts":1,"wisdom":1,"strategy":"Nige","distanceAptitude":"S","surfaceAptitude":"S","strategyAptitude":"S"},"paceEffectsEnabled":false,"nsamples":1,"presupposedSkills":["900681"],"skillsUnderTest":[]},
	{"seed":-1102294425,"courseId":"11007","groundCondition":1,"mood":-2,"horse":{"speed":11,"stamina":11,"power":2,"guts":1842,"wisdom":692,"strategy":"Senkou","distanceAptitude":"C","surfaceAptitude":"E","strategyAptitude":"E"},"paceEffectsEnabled":false,"nsamples":131,"presupposedSkills":["202102","900521"],"skillsUnderTest":["200311","201662"]},
	{"seed":-1465258475,"courseId":"10605","groundCondition":0,"mood":-2,"horse":{"speed":1,"stamina":1,"power":1,"guts":1,"wisdom":1,"strategy":"Nige","distanceAptitude":"S","surfaceAptitude":"S","strategyAptitude":"S"},"paceEffectsEnabled":false,"nsamples":1,"presupposedSkills":["200233"],"skillsUnderTest":[]}
];

test('no regressions on known cases', t => {
	t.plan(cases.length);

	cases.forEach(testCase => {
		const builder = makeBuilder(testCase as RaceParams);
		testCase.skillsUnderTest.forEach(id => builder.addSkill(id));

		const g = builder.build();
		let ok = true;
CASE:
		for (let i = 0; i < testCase.nsamples; ++i) {
			const s = g.next().value as RaceSolver;
			let lastPos = 0;
			let steps = 0;
			while (s.pos < builder._course.distance) {
				s.step(1/15);
				if (isNaN(s.pos)) {
					console.error('err: isNaN: time ' + s.accumulatetime.t);
					console.error(s);
					ok = false;
					break CASE;
				}
				if (s.pos <= lastPos) {
					console.error('err: not moving or going backwards: time: ' + s.accumulatetime.t + ' pos: ' + s.pos + ' lastPos: ' + lastPos);
					console.error(s);
					ok = false;
					break CASE;
				}
				if (++steps > builder._course.distance * 15) {
					console.warn('warn: going suspiciously long: time: ' + s.accumulatetime.t);
					console.warn(s);
					ok = false;
					break CASE;
				}
				lastPos = s.pos;
			}
		}
		t.ok(ok);
	});
});
