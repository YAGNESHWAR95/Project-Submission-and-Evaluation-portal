const getStatusMessage = (status) => {
  if (status === 'needs_ocr') return 'No readable PDF text was extracted. This report may be scanned; OCR is not configured.';
  if (status === 'insufficient_text') return 'Too little readable report text was available for comparison.';
  if (status === 'no_comparisons') return 'No eligible prior proposal or report text was available in this portal.';
  if (status === 'failed') return 'Report comparison did not complete. No similarity score is available.';
  return '';
};

export default function ReportOriginalityPanel({ analysis }) {
  if (!analysis) return null;

  const coverage = analysis.comparisonCoverage || {};
  const semanticMatch = analysis.matches?.find((match) => (
    match.semanticStatus === 'available'
    && match.semanticSimilarity !== null
    && match.semanticSimilarity !== undefined
  ));

  return (
    <section className="border-t border-slate-700 pt-4 text-sm">
      <h4 className="font-semibold">Report text comparison</h4>
      {analysis.status === 'completed' ? (
        <>
          <p className="mt-1 font-semibold">
            {analysis.overallScore === null || analysis.overallScore === undefined
              ? 'Similarity score unavailable'
              : `${Number(analysis.overallScore).toFixed(2)}% TF-IDF text similarity`}
          </p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {coverage.pagesAnalyzed ?? 0}/{coverage.pagesAvailable ?? 0} report pages analyzed; {coverage.projectsCompared ?? 0} portal projects compared ({coverage.proposalSourcesCompared ?? 0} proposals, {coverage.priorReportSourcesCompared ?? 0} prior reports).
          </p>
          {semanticMatch ? (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Separate Sentence-BERT score: {Number(semanticMatch.semanticSimilarity).toFixed(2)}%.</p>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {analysis.semanticStatus === 'unavailable'
                ? 'Sentence-BERT unavailable; no semantic percentage was recorded.'
                : 'No semantic percentage was computed.'}
            </p>
          )}
          {analysis.matches?.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {analysis.matches.map((match) => (
                <li key={`${match.projectId}-${match.matchedSource}`} className="border-l-2 border-amber-500/50 pl-3">
                  <p className="font-medium">{match.title || 'Prior portal project'} · {match.matchedSource}{match.sourcePhase ? ` (${match.sourcePhase} V${match.sourceVersion})` : ''} · {Number(match.similarityScore).toFixed(2)}%</p>
                  <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{match.evidence}</p>
                  {match.matchingSections?.map((section) => (
                    <p key={`${section.reportPage}-${section.matchedSource}`} className="mt-1 text-xs text-[var(--text-secondary)]">
                      Page {section.reportPage}, {section.matchedSource}{section.matchedPhase ? ` (${section.matchedPhase} V${section.matchedVersion})` : ''} · {Number(section.similarityScore).toFixed(2)}% section similarity
                      {section.matchingTerms?.length ? ` · Shared terms: ${section.matchingTerms.join(', ')}` : ''}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-[var(--text-secondary)]">No positive text overlap was found in the compared portal sources.</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{getStatusMessage(analysis.status)}</p>
      )}
      <p className="mt-3 text-xs text-[var(--text-secondary)]">
        Similarity indicates overlapping text in portal records; it does not establish plagiarism. External publications were not checked.
      </p>
    </section>
  );
}