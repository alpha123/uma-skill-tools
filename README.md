# uma-skill-tools

Tools and libraries for simulating races in ウマ娘 プリティーダービー and analyzing skill effects. See the readme in the tools/ folder for usage of the command-line tools.

Setup:

```
git clone https://github.com/alpha123/uma-skill-tools.git
cd uma-skill-tools
npm install --dev
```

This will install `ts-node`, which you can use to run the CLI tools.

Charting features require Python and matplotlib.

# Design

Broadly, the framework is divided into two parts:

- Simulating a race
- Parsing skill conditions and turning them into points on a course where the skill will activate

The former is mostly contained in RaceSolver.ts, which numerically integrates your position and velocity over the course of a race. It is provided with effects that activate at specified times, which is used to implement skills. Activation is controlled by *static conditions* or a *trigger*, which is just a region on the track, and *dynamic conditions*, which is a boolean function dependent on the state of the race solver. Once a trigger is entered, the corresponding dynamic conditions are checked and if they return true the effect is activated for a specified duration.

The latter part is responsible for taking skill data mined from the game and generating the triggers and dynamic conditions. It can be further subdivided into two parts:

- ConditionParser.ts and ActivationConditions.ts, which parse the skill conditions into a tree and, given a course, reduce that to a list of regions on the course where the skill has the *potential* to activate, and its dynamic conditions (if any).
- ActivationSamplePolicy.ts, which samples the list of regions to determine triggers for where the skill will actually activate. Since many skills are either random or modeled as random, many samples are supposed to be taken and the race solver ran many times with different sampled trigger points.

Each skill condition has an associated *sample policy* such as immediate, random (of various types), or random according to a particular probability distribution. Immediate means all samples are the earliest point in their allowable regions, for example phase>=2 is immediate and all samples will be the start of phase 2. The difference between the two random types is the former is used for actually random conditions (i.e., ones that end in \_random, like phase_random, all_corner_random, etc) and the latter is used for conditions that are not actually random but involve other umas in some way and so are modeled as random. When skill conditions are combined with & or @ some sample policies dominate other ones, so something like is_lastspurt==1&phase_random==3 will be sampled randomly (is_lastspurt==1 would otherwise always be sampled as activating immediately).

The sample policy associated with a condition is more of just a default and technically the output of any condition tree can be sampled with any sample policy. This is intended to allow the user some choice in how certain conditions are modeled, since the sample policy is what controls where a given skill is "likely" to activate.

# Caveats

## Does not fully simulate a race, only simulates one uma

This is by design. The intention is to determine the distance gain of skills which requires as controlled of an environment as possible. Trying to simulate a full race with other umas makes it too difficult to isolate the effects of a single skill.

This has a lot of secondary effects. Many skill conditions involve other umas in some way. Those conditions are instead modeled by probability distributions based mainly on guessing where they tend to activate.

### Position keep

Due to obviously involving other umas, position keep is mostly not simulated except for pace down for non-runners at the beginning of a race. In this case the pace down is fairly predictable and has effects on the efficiency of certain skills, so it is simulated.

Runner speed up mode/overtake mode is probably relatively predictable early in the race and may be implemented in the future.

### Order conditions

Obviously since no other umas exist conditions like order, order_rate, etc are meaningless. By default these are assumed to always be fulfilled, which I think is the expected behavior in most cases since you only really care about things like angling, anabolic, etc activating immediately. It's possible to use one of the random sample policies with these anyway, which may be useful for modeling anabolic+gear combo or something.

## Does not take inner/outer lane differences into account

It's kind of pointless to try to simulate lane changing because it's both too random and too dependent on other umas. The difference in distance traveled between inner and outer lanes can be quite significant, but probably doesn't affect the efficiency of skills that much.

## Skills that combine accumulatetime with a condition modeled by a probability distribution activate too early a lot of the time

This is a bug but somewhat hard to fix with the current architecture. Basically, they activate immediately after the accumulatetime condition is satisfied more than would be predicted by the distribution used to model them. Fixing this is kind of non-trivial and in practice I think it's not really that important.

List of skills affected:

- ウマ好み / ウママニア
- 先頭プライド / トップランナー
- 遊びはおしまいっ！ / お先に失礼っ！
- スリップストリーム
- 負けん気 / 姉御肌
- 砂浴び○ / 優雅な砂浴び
- possibly others

## Not yet implemented

All of these things should be doable with the current architecture and are planned for the near future.

### Does not simulate kakari

Easily doable but no real point without tracking hp consumption since both simulations would always kakari at the same point during a comparison.

If it is implemented would probably have the effect of increasing int decreasing average バ身 gain due to less kakari, since position keep effects aren't simulated which would otherwise counteract it.

### Scaling effects are not implemented yet

Some of these are going to be a real pain.

### Skill cooldowns

At the moment skills can only activate once and skills with a cooldown (like 弧線のプロフェッサー or ハヤテ一文字) only activate once. This is hard to implement without some relatively major organizational changes (currently pending).

# Credit

English skill names are from [GameTora](https://gametora.com/umamusume).

KuromiAK#4505 on Discord let me hassle him about various minutiae of game mechanics.

# License

Copyright (C) 2022  pecan

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
