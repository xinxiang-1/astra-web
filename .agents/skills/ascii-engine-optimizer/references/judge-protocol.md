# Pairwise visual judge protocol

Use model judging only after objective filtering and only when the user authorizes the external calls and cost.

## Evaluation packet

Provide the same packet for A and B:

- original source;
- fit-to-frame overview;
- native 100% glyph crop at the same subject region;
- fixed keyframes or a fixed-duration clip for motion;
- no filenames, parameters, previous scores, or candidate history.

## Rubric

Require structured output:

- choice: `A`, `B`, or `tie`;
- structure, readability, tonal/color quality, composition, and motion stability scores when applicable;
- confidence in `[0,1]`;
- failure codes from a maintained vocabulary;
- short evidence tied to visible regions.

## Bias controls

1. Evaluate A/B, then B/A with the same rubric.
2. Accept a result only when the swapped judgments agree after remapping, or resolve it with a third vote.
3. Randomize candidate identifiers and ordering.
4. Cache by source hash, artifact hashes, crop specification, rubric version, and model version.
5. Regularly include human-labeled gold pairs. Track accuracy, tie rate, position bias, and confidence calibration.
6. Do not silently replace the judge model. A model change starts a new judge version and calibration run.

## Failure handling

- Invalid structured output: retry once, then mark unjudged.
- Low confidence: retain the objective score and route to human review when important.
- Persistent model/human disagreement: do not average it away; add it to the evaluator failure set.
- Cost or call budget reached: stop judging and report remaining candidates as objectively ranked only.
