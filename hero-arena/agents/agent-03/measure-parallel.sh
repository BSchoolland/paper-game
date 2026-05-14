#!/usr/bin/env bash
# Parallel head-to-head harness. Runs all (opponent, seed, side) matches concurrently across
# CPU cores. Each child writes one CSV line; this script aggregates them.
#
#   HERO_TURN_BUDGET_MS=2000 SEEDS="1 7 42" PARALLEL=6 ./measure-parallel.sh
#   HERO_TURN_BUDGET_MS=2000 SEEDS="1 7 42" PARALLEL=6 ./measure-parallel.sh agent-02 agent-05
#
# Defaults: all 7 opponents, seeds "1 7 42", PARALLEL=6.

set -u
cd "$(dirname "$0")/../../.."  # hero-arena/agents/agent-03 → repo root

OPPS=${*:-"agent-01 agent-02 agent-04 agent-05 agent-06 agent-07 agent-08"}
SEEDS=${SEEDS:-"1 7 42"}
PARALLEL=${PARALLEL:-6}
BUDGET=${HERO_TURN_BUDGET_MS:-2000}
BUN=${BUN:-$HOME/.bun/bin/bun}

STAMP=$(date +%Y%m%d-%H%M%S)
TMP=$HOME/.measure-runs/$STAMP
mkdir -p "$TMP"
echo "results dir: $TMP" >&2

# Spawn jobs, throttling to $PARALLEL at a time.
i=0
for opp in $OPPS; do
  for seed in $SEEDS; do
    for side in red blue; do
      i=$((i+1))
      # Wait for a slot.
      while [ "$(jobs -rp | wc -l)" -ge "$PARALLEL" ]; do wait -n 2>/dev/null || sleep 0.1; done
      HERO_TURN_BUDGET_MS=$BUDGET "$BUN" hero-arena/agents/agent-03/measure-one.ts "$opp" "$seed" "$side" \
        > "$TMP/$i.csv" 2>"$TMP/$i.err" &
    done
  done
done
wait

# Aggregate.
cat "$TMP"/*.csv > "$TMP/all.csv"
echo "agent-03 head-to-head @ ${BUDGET}ms/turn, seeds [$SEEDS], parallel=$PARALLEL"
awk -F, '
  {
    opp=$1; seed=$2; side=$3; out=$4; mF=$5; tF=$6;
    n[opp]++; mg[opp] += (mF - tF);
    if (out=="W") w[opp]++; else if (out=="D") d[opp]++; else l[opp]++;
    detail[opp] = detail[opp] " " substr(side,1,1) seed":"out int((mF-tF)*100);
  }
  END {
    total_w=0; total_d=0; total_l=0; total_pts=0; losing="";
    for (o in n) {
      pts = w[o]*3 + d[o];
      total_w += w[o]+0; total_d += d[o]+0; total_l += l[o]+0; total_pts += pts;
      printf "  vs %-10s W%d D%d L%d  margin %.1f%%  pts %d/%d  [%s]\n", \
        o, w[o]+0, d[o]+0, l[o]+0, mg[o]/n[o]*100, pts, n[o]*3, substr(detail[o],2);
      if (l[o]+0 >= w[o]+0) losing = losing " " o;
    }
    printf "\nTOTAL: W%d D%d L%d pts %d\n", total_w, total_d, total_l, total_pts;
    if (losing != "") printf "Losing/tied matchups:%s\n", losing;
    else printf "\xE2\x9C\x93 winning every matchup\n";
  }
' "$TMP/all.csv" | sort
