export const validProbability = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
export const choice = answer => answer?.type === 'choice' ? answer.choice : null;
export const choiceProbability = answer => answer?.type === 'choice' && validProbability(answer.probabilities?.[answer.choice]) ? answer.probabilities[answer.choice] : null;
export function predicateReading(answer) {
  const probability = answer?.type === 'noul' && validProbability(answer.noul) ? answer.noul : null;
  return { probability, value: probability === null ? 'UNKNOWN' : probability >= .65 ? 'TRUE' : probability <= .35 ? 'FALSE' : 'UNCERTAIN' };
}
export function scoreReading(answer) {
  return answer?.type === 'score' && Number.isFinite(answer.score) && answer.score >= 0 && answer.score <= 4 ? answer.score : null;
}
