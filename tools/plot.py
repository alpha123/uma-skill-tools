import sys
import argparse
import json
import matplotlib.pyplot as plt


opts = argparse.ArgumentParser()
opts.add_argument('--accel', '-a', action='store_true')
opts.add_argument('--velocity', '-v', action='store_true')
opts.add_argument('--target-velocity', '-tv', action='store_true')
opts.add_argument('--position', '-p', action='store_true')
opts.add_argument('--velocity-offset', '-vo', type=int, default=0)
args = opts.parse_args()

data = json.load(sys.stdin)

if args.accel:
	plt.plot(data['t'], data['a'])
if args.velocity:
	plt.plot(data['t'], list(map(lambda x: max(args.velocity_offset, x), data['v'])))
if args.target_velocity:
	plt.plot(data['t'], list(map(lambda x: max(args.velocity_offset, x), data['targetv'])))
if args.position:
	plt.plot(data['t'], data['pos'])

plt.show()
