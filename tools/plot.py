import sys
import argparse
import json
from bisect import bisect_left
import matplotlib.pyplot as plt


opts = argparse.ArgumentParser(add_help=False)
opts.add_argument('--help', action='help', help='show this help message and exit')
opts.add_argument('--accel', '-a', action='store_true')
opts.add_argument('--velocity', '-v', action='store_true')
opts.add_argument('--target-velocity', '-r', action='store_true')
opts.add_argument('--position', '-p', action='store_true')
opts.add_argument('--velocity-offset', '-o', type=int, default=0)
opts.add_argument('--hills', '-h', action='store_true')
opts.add_argument('--corners', '-c', action='store_true')
opts.add_argument('--straights', '-s', action='store_true')
args = opts.parse_args()

data = json.load(sys.stdin)

with open('../data/course_data.json', 'r', encoding='utf-8') as f:
	tracks = json.load(f)
	course = tracks[str(data['trackId'])]['courses'][str(data['courseId'])]

plt.figure(figsize=(15,5))

if args.accel:
	plt.plot(data['t'], data['a'], color='limegreen')
if args.velocity:
	plt.plot(data['t'], list(map(lambda x: max(args.velocity_offset, x), data['v'])), color='navy')
if args.target_velocity:
	plt.plot(data['t'], list(map(lambda x: max(args.velocity_offset, x), data['targetv'])), color='cornflowerblue')
if args.position:
	plt.plot(data['t'], data['pos'])

def pos_to_t(pos):
	i = bisect_left(data['pos'], pos)
	return data['t'][i if i == len(data['pos']) - 1 or abs(data['pos'][i] - pos) < abs(data['pos'][i + 1] - pos) else i + 1]

right = course['turn'] == 1

if args.hills:
	for hill in course['slopes']:
		if hill['slope'] < 0:
			color = '#7dffbe'
			dir = '↓'
			orient = '↘' if right else '↙'
		else:
			color = '#f0eb69'
			dir = '↑'
			orient = '↗' if right else '↖'

		label = f"{orient} {hill['start']}m~{hill['start']+hill['length']}m ({dir}{abs(hill['slope']) / 10000})"
		start_t = pos_to_t(hill['start'])
		end_t = pos_to_t(hill['start'] + hill['length'])
		plt.axvspan(start_t, end_t, color=color, alpha=0.2, label=label)

if args.corners:
	for corner in course['corners']:
		start_t = pos_to_t(corner['start'])
		end_t = pos_to_t(corner['start'] + corner['length'])
		orient = '↷' if right else '↶'
		plt.axvspan(start_t, end_t, color='#e1beff', alpha=0.2, label=f"{orient} {corner['start']}m~{corner['start']+corner['length']}m")

if args.straights:
	for straight in course['straights']:
		start_t = pos_to_t(straight['start'])
		end_t = pos_to_t(straight['end'])
		orient = '→' if right else '←'
		plt.axvspan(start_t, end_t, color='#d1ebff', alpha=0.2, label=f"{orient} {straight['start']}m~{straight['end']}m")

plt.xlim([0, data['t'][-1]])
plt.legend()
plt.tight_layout()
plt.show()
