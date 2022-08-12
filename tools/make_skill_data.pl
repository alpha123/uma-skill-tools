use strict;
use warnings;
use v5.012;

use DBI;
use DBD::SQLite::Constants qw(:file_open);
use JSON::PP;

if (!@ARGV) {
	die 'Usage: make_skill_data.pl master.mdb';
}

my $mastermdb = shift @ARGV;

my $db = DBI->connect("dbi:SQLite:$mastermdb", undef, undef, {
	sqlite_open_flags => SQLITE_OPEN_READONLY
});
$db->{RaiseError} = 1;

my $select = $db->prepare(<<SQL
SELECT id, rarity,
       precondition_1, condition_1,
       float_ability_time_1,
       ability_type_1_1, float_ability_value_1_1,
       ability_type_1_2, float_ability_value_1_2,
       ability_type_1_3, float_ability_value_1_3,

       precondition_2, condition_2,
       float_ability_time_2,
       ability_type_2_1, float_ability_value_2_1,
       ability_type_2_2, float_ability_value_2_2,
       ability_type_2_3, float_ability_value_2_3
  FROM skill_data
 WHERE is_general_skill = 1;
SQL
);

$select->execute;

my (
	$id, $rarity,
	$precondition_1, $condition_1,
	$float_ability_time_1,
	$ability_type_1_1, $float_ability_value_1_1,
	$ability_type_1_2, $float_ability_value_1_2,
	$ability_type_1_3, $float_ability_value_1_3,

	$precondition_2, $condition_2,
	$float_ability_time_2,
	$ability_type_2_1, $float_ability_value_2_1,
	$ability_type_2_2, $float_ability_value_2_2,
	$ability_type_2_3, $float_ability_value_2_3
);

$select->bind_columns(\(
	$id, $rarity,
	$precondition_1, $condition_1,
	$float_ability_time_1,
	$ability_type_1_1, $float_ability_value_1_1,
	$ability_type_1_2, $float_ability_value_1_2,
	$ability_type_1_3, $float_ability_value_1_3,

	$precondition_2, $condition_2,
	$float_ability_time_2,
	$ability_type_2_1, $float_ability_value_2_1,
	$ability_type_2_2, $float_ability_value_2_2,
	$ability_type_2_3, $float_ability_value_2_3
));

my $skills = {};
while ($select->fetch) {
	my @effects_1 = ({type => $ability_type_1_1, modifier => $float_ability_value_1_1});
	if ($ability_type_1_2 != 0) {
		push @effects_1, {type => $ability_type_1_2, modifier => $float_ability_value_1_2};
	}
	if ($ability_type_1_3 != 0) {
		push @effects_1, {type => $ability_type_1_3, modifier => $float_ability_value_1_3};
	}
	my @triggers = ({
		precondition => $precondition_1,
		condition => $condition_1,
		baseDuration => $float_ability_time_1,
		effects => \@effects_1
	});
	if ($condition_2 ne '') {
		my @effects_2 = ({type => $ability_type_2_1, modifier => $float_ability_value_2_1});
		if ($ability_type_2_2 != 0) {
			push @effects_2, {type => $ability_type_2_2, modifier => $float_ability_value_2_2};
		}
		if ($ability_type_2_3 != 0) {
			push @effects_2, {type => $ability_type_2_3, modifier => $float_ability_value_2_3};
		}
		push @triggers, {
			precondition => $precondition_2,
			condition => $condition_2,
			baseDuration => $float_ability_time_2,
			effects => \@effects_2
		};
	}
	$skills->{$id} = {rarity => $rarity, alternatives => \@triggers};
}

my $json = JSON::PP->new;
$json->canonical(1);
say $json->encode($skills);
