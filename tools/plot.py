import sys
import argparse
import json
from bisect import bisect_left
from collections import defaultdict
import matplotlib.pyplot as plt
from matplotlib import font_manager

opts = argparse.ArgumentParser(add_help=False)
opts.add_argument('--help', action='help', help='show this help message and exit')
opts.add_argument('--accel', '-a', action='store_true')
opts.add_argument('--velocity', '-v', action='store_true')
opts.add_argument('--target-velocity', '-r', action='store_true')
opts.add_argument('--position', action='store_true')
opts.add_argument('--velocity-offset', '-o', type=int, default=0)
opts.add_argument('--hills', '-h', action='store_true')
opts.add_argument('--corners', '-c', action='store_true')
opts.add_argument('--straights', '-s', action='store_true')
opts.add_argument('--phase', '-p', action='store_true')
opts.add_argument('--skills', '-k', action='store_true')
opts.add_argument('--lang', choices=('jp','en'), default='jp', help='language for skill names')
args = opts.parse_args()

data = json.load(sys.stdin)

with open('../data/course_data.json', 'r', encoding='utf-8') as f:
	tracks = json.load(f)
	course = tracks[str(data['trackId'])]['courses'][str(data['courseId'])]

if args.lang == 'jp':
	font = font_manager.FontProperties()
	font.set_family('MS Gothic')

plt.figure(figsize=(15,5))

if args.accel:
	plt.plot(data['t'], data['a'], color='limegreen', label='Acceleration')
if args.velocity:
	plt.plot(data['t'], data['v'], color='navy', label='Current speed')
if args.target_velocity:
	plt.plot(data['t'], data['targetv'], color='cornflowerblue', label='Target speed')
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
			hatch = '\\'
		else:
			color = '#f0eb69'
			dir = '↑'
			hatch = '/'
			orient = '↗' if right else '↖'

		label = f"{orient} {hill['start']}m~{hill['start']+hill['length']}m ({dir}{abs(hill['slope']) / 10000})"
		start_t = pos_to_t(hill['start'])
		end_t = pos_to_t(hill['start'] + hill['length'])
		plt.axvspan(start_t, end_t, color=color, alpha=0.3, hatch=hatch, label=label)

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
		plt.axvspan(start_t, end_t, color='#d1ebff', alpha=0.3, hatch='-', label=f"{orient} {straight['start']}m~{straight['end']}m")

if args.phase:
	plt.axvline(pos_to_t(course['distance'] * 1/6), color='dimgray', alpha=0.2, ls='--', label=f"Mid leg start ({round(course['distance']*1/6)}m)")
	plt.axvline(pos_to_t(course['distance'] * 2/3), color='dimgray', alpha=0.2, ls='--', label=f"Last leg start ({round(course['distance']*2/3)}m)")
	plt.axvline(pos_to_t(course['distance'] * 5/6), color='dimgray', alpha=0.2, ls=':')

if args.skills:
	with open('skillnames.json', 'r', encoding='utf-8') as f:
		skillnames = json.load(f)

	xtr = plt.gca().get_xaxis_transform()

	starts = sorted(list(map(lambda i: i[1], data['skills'].values())))
	ends = sorted(list(map(lambda i: i[2], data['skills'].values())))
	n_at = defaultdict(lambda: 0)
	for skill,info in data['skills'].items():
		color = ['red','orangered','firebrick','dodgerblue'][info[0]]
		nactive = bisect_left(starts, info[1]) - bisect_left(ends, info[1]) + n_at[info[1]]
		n_at[info[1]] += 1
		h = 0.04
		plt.axvspan(info[1], info[2], ymin=nactive*h, ymax=nactive*h+h, color=color, alpha=0.5, label=f"{skillnames[skill][args.lang == 'en']} {round(info[3])}m~{round(info[4])}m")
		plt.text(info[1], nactive*h+0.01, skillnames[skill][args.lang == 'en'], transform=xtr, fontproperties=font, fontsize='small')

seconds = range(0, round(data['t'][-1])+1)
plt.xticks(seconds, list(map(lambda t: '{:d}:{:02d}'.format(*divmod(t,60)), seconds)), rotation=45, rotation_mode='anchor', fontsize='xx-small', ha='right')

plt.xlim([0, data['t'][-1]])
if args.target_velocity:
	plt.ylim([args.velocity_offset, max(data['targetv'])+1])
elif args.velocity:
	plt.ylim([args.velocity_offset, max(data['v'])+1])
	# NB. if they are both specified, max(targetv) >= max(v)

if args.lang == 'jp':
	plt.legend(prop=font)
else:
	plt.legend()
plt.tight_layout()
plt.show()
