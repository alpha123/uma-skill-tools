use strict;
use warnings;
use v5.012;

use DBI;
use DBD::SQLite::Constants qw(:file_open);
use JSON::PP;

if (@ARGV < 2) {
	die "Usage: make_course_data.pl master.mdb courseeventparam"
}

my $mastermdb = shift @ARGV;
my $course_event_params = shift @ARGV;

my $db = DBI->connect("dbi:SQLite:$mastermdb", undef, undef, {
	sqlite_open_flags => SQLITE_OPEN_READONLY
});
$db->{RaiseError} = 1;

sub distance_type {
	my $distance = shift;
	if ($distance <= 1200) {
		return 1;
	} elsif ($distance <= 1800) {
		return 2;
	} elsif ($distance < 2500) {
		return 3;
	} elsif ($distance >= 2500) {
		return 4;
	}
}

my $get_course_set_statuses = $db->prepare('SELECT course_set_status_id, target_status_1, target_status_2 FROM race_course_set_status;');

$get_course_set_statuses->execute;

my ($css_id, $status_1, $status_2);
$get_course_set_statuses->bind_columns(\($css_id, $status_1, $status_2));

my @course_set_status = ();
while ($get_course_set_statuses->fetch) {
	my @statuses = ($status_1);
	if ($status_2 != 0) {
		push @statuses, $status_2;
	}
	$course_set_status[$css_id] = \@statuses;
}

# Currently finish_time_min_random_range and finish_time_max_random_range are always 10000
# If that changes in the future maybe we'll need to include those in course data but skip them for now
my $get_courses = $db->prepare(<<SQL
SELECT id, race_track_id, distance, ground, inout, turn, float_lane_max, course_set_status_id,
       finish_time_min, finish_time_max
  FROM race_course_set;
SQL
);

$get_courses->execute;

my ($id, $race_track_id, $distance, $ground, $inout, $turn, $lane_max, $finish_time_min, $finish_time_max);

$get_courses->bind_columns(\($id, $race_track_id, $distance, $ground, $inout, $turn, $lane_max, $css_id, $finish_time_min, $finish_time_max));

my $courses = {};
while ($get_courses->fetch) {
	if ($id == 11201 || $id == 11202) {  # Longchamp 1000m course is incomplete and data for id 11202 doesn't exist
		next;
	}

	my $events = decode_json(do { local(@ARGV, $/) = "$course_event_params/$id/CourseParamTable.json"; <> })->{courseParams};
	my @corners;
	my @straights;
	my @slopes;
	my $pending_straight;
	my $straight_state = 0;
	for my $event (@$events) {
		if ($event->{_paramType} == 0) {
			push @corners, {start => $event->{_distance}, length => $event->{_values}->[1]};
		} elsif ($event->{_paramType} == 2) {
			if ($straight_state == 0) {
				if ($event->{_values}->[0] != 1) {
					die "confused about course event params: straight ended before it started? (course id $id)";
				}
				$pending_straight = {start => $event->{_distance}, frontType => $event->{_values}->[1]};
				$straight_state = 1;
			} else {
				if ($event->{_values}->[0] != 2) {
					die "confused about course event params: new straight started before previous straight ended (course id $id)";
				}
				$pending_straight->{end} = $event->{_distance};
				push @straights, $pending_straight;
				$straight_state = 0;
			}
		} elsif ($event->{_paramType} == 11) {
			push @slopes, {start => $event->{_distance}, length => $event->{_values}->[1], slope => $event->{_values}->[0]};
		}
	}

	@corners = sort { $a->{start} <=> $b->{start} } @corners;
	@straights = sort { $a->{start} <=> $b->{start} } @straights;
	@slopes = sort { $a->{start} <=> $b->{start} } @slopes;

	$courses->{$id} = {
		raceTrackId => $race_track_id,
		distance => $distance,
		distanceType => distance_type($distance),
		surface => $ground,
		turn => $turn,
		course => $inout,
		laneMax => $lane_max,
		finishTimeMin => $finish_time_min,
		finishTimeMax => $finish_time_max,
		courseSetStatus => $course_set_status[$css_id] || [],
		corners => \@corners,
		straights => \@straights,
		slopes => \@slopes
	};
}

my $json = JSON::PP->new;
$json->canonical(1);
say $json->encode($courses);
