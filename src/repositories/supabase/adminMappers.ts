import type {
  AdminDisplayState,
  AdminLectureSummary,
  AdminMaterialAnalysis,
  AdminMaterialPublication,
  AdminMaterialResults,
  AdminMaterialSummaryBody,
  AdminPollProposal,
  AdminSummaryResults,
} from '../supabaseAdminRepository'

export type DisplayStateRow = {
  current_pdf_page: number
  display_mode: AdminDisplayState['displayMode']
  lecture_session_id: string
  pdf_document_id: string | null
  pdf_document_version: string | null
  pdf_manifest_version: number
  pdf_page_count: number | null
  pdf_visible: boolean
  updated_at: string
}

export type RawMaterialResults = {
  analysis?: null | {
    created_at: string
    id: string
    important_pages: number[]
    key_terms: AdminMaterialAnalysis['keyTerms']
    material_outline: AdminMaterialAnalysis['materialOutline']
    material_summary: string
    model_id: string
    operation_id: string
    section_boundaries: AdminMaterialAnalysis['sectionBoundaries']
    source_document_id: string
    source_document_version: string
  }
  publication?: null | {
    analysis_id: string
    body: AdminMaterialSummaryBody
    published_at: string | null
    review_state: AdminMaterialPublication['reviewState']
    updated_at: string
    version: number | string
    visibility: AdminMaterialPublication['visibility']
  }
  proposals?: Array<{
    adopted_poll_id: string | null
    analysis_id: string
    correct_option_ids: string[]
    created_at: string
    difficulty: AdminPollProposal['difficulty']
    educational_value: string
    evidence_excerpt_ids: string[]
    evidence_pages: number[]
    explanation: string
    id: string
    learning_objective: string
    misconception_target: string | null
    options: AdminPollProposal['options']
    proposal_type: AdminPollProposal['proposalType']
    quality_score: number | string
    reviewed_at: string | null
    status: AdminPollProposal['status']
    stem: string
  }>
}

export type RawSummaryResults = {
  control?: null | Record<string, unknown>
  run?: null | Record<string, unknown>
  summaries?: Array<Record<string, unknown>>
  windows?: Array<Record<string, unknown>>
}

export function toAdminDisplayState(row: DisplayStateRow): AdminDisplayState {
  return {
    currentPdfPage: row.current_pdf_page,
    displayMode: row.display_mode,
    lectureSessionId: row.lecture_session_id,
    pdfDocumentId: row.pdf_document_id,
    pdfDocumentVersion: row.pdf_document_version,
    pdfManifestVersion: row.pdf_manifest_version,
    pdfPageCount: row.pdf_page_count,
    pdfVisible: row.pdf_visible,
    updatedAt: row.updated_at,
  }
}

export function toAdminMaterialResults(
  value: RawMaterialResults | null | undefined,
): AdminMaterialResults {
  const analysis = value?.analysis
  const publication = value?.publication
  return {
    analysis: analysis
      ? {
          createdAt: analysis.created_at,
          id: analysis.id,
          importantPages: analysis.important_pages,
          keyTerms: analysis.key_terms,
          materialOutline: analysis.material_outline,
          materialSummary: analysis.material_summary,
          modelId: analysis.model_id,
          operationId: analysis.operation_id,
          sectionBoundaries: analysis.section_boundaries,
          sourceDocumentId: analysis.source_document_id,
          sourceDocumentVersion: analysis.source_document_version,
        }
      : null,
    publication: publication
      ? {
          analysisId: publication.analysis_id,
          body: publication.body,
          publishedAt: publication.published_at,
          reviewState: publication.review_state,
          updatedAt: publication.updated_at,
          version: Number(publication.version),
          visibility: publication.visibility,
        }
      : null,
    proposals: (value?.proposals ?? []).map((proposal) => ({
      adoptedPollId: proposal.adopted_poll_id,
      analysisId: proposal.analysis_id,
      correctOptionIds: proposal.correct_option_ids,
      createdAt: proposal.created_at,
      difficulty: proposal.difficulty,
      educationalValue: proposal.educational_value,
      evidenceExcerptIds: proposal.evidence_excerpt_ids,
      evidencePages: proposal.evidence_pages,
      explanation: proposal.explanation,
      id: proposal.id,
      learningObjective: proposal.learning_objective,
      misconceptionTarget: proposal.misconception_target,
      options: proposal.options,
      proposalType: proposal.proposal_type,
      qualityScore: Number(proposal.quality_score),
      reviewedAt: proposal.reviewed_at,
      status: proposal.status,
      stem: proposal.stem,
    })),
  }
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function toAdminSummaryResults(
  raw?: RawSummaryResults,
): AdminSummaryResults {
  const control = raw?.control ?? null
  const run = raw?.run ?? null
  return {
    control: control
      ? {
          budgetLimitMicrousd: Number(control.budget_limit_microusd ?? 0),
          inputTokenLimit: Number(control.input_token_limit ?? 0),
          inputTokensUsed: Number(control.input_tokens_used ?? 0),
          outputTokenLimit: Number(control.output_token_limit ?? 0),
          outputTokensUsed: Number(control.output_tokens_used ?? 0),
          status: String(control.status ?? 'disabled'),
          summariesEnabled: Boolean(control.summaries_enabled),
          summaryCallLimit: Number(control.summary_call_limit ?? 18),
          summaryCallsUsed: Number(control.summary_calls_used ?? 0),
          usedMicrousd: Number(control.used_microusd ?? 0),
        }
      : null,
    run: run
      ? {
          expiresAt: String(run.expires_at ?? ''),
          id: String(run.id ?? ''),
          lastWindowIndex: Number(run.last_window_index ?? 0),
          status: String(
            run.status ?? 'stopped',
          ) as AdminSummaryResults['run'] extends infer T
            ? T extends { status: infer S }
              ? S
              : never
            : never,
        }
      : null,
    summaries: (raw?.summaries ?? []).map((item) => {
      const output = (item.ai_output ?? {}) as Record<string, unknown>
      const publication = (item.publication ?? null) as Record<
        string,
        unknown
      > | null
      return {
        aiOutput: {
          academicQuestionCandidate:
            (output.academic_question_candidate as AdminLectureSummary['aiOutput']['academicQuestionCandidate']) ??
            null,
          commentPulse: toStringArray(output.comment_pulse),
          lectureRecap: toStringArray(output.lecture_recap),
        },
        createdAt: String(item.created_at ?? ''),
        id: String(item.id ?? ''),
        modelId: String(item.model_id ?? ''),
        promptVersion: String(item.prompt_version ?? ''),
        publication: publication
          ? {
              activeRevisionId: String(publication.active_revision_id ?? ''),
              pinnedOrder:
                publication.pinned_order == null
                  ? null
                  : Number(publication.pinned_order),
              pinnedUntil:
                publication.pinned_until == null
                  ? null
                  : String(publication.pinned_until),
              publishedAt:
                publication.published_at == null
                  ? null
                  : String(publication.published_at),
              reviewState: String(
                publication.review_state ?? 'ai_unreviewed',
              ) as AdminLectureSummary['publication'] extends infer T
                ? T extends { reviewState: infer S }
                  ? S
                  : never
                : never,
              visibility: String(publication.visibility ?? 'hidden') as
                'hidden' | 'public',
            }
          : null,
        qualityResult: (item.quality_result ?? {}) as Record<string, unknown>,
        revisions: (
          (item.revisions ?? []) as Array<Record<string, unknown>>
        ).map((revision) => {
          const revisionBody = (revision.body ?? {}) as Record<string, unknown>
          return {
            authorActorId:
              revision.author_actor_id == null
                ? null
                : String(revision.author_actor_id),
            authorType: String(revision.author_type ?? 'ai') as 'admin' | 'ai',
            body: {
              commentPulse: toStringArray(revisionBody.comment_pulse),
              lectureRecap: toStringArray(revisionBody.lecture_recap),
            },
            createdAt: String(revision.created_at ?? ''),
            id: String(revision.id ?? ''),
            reason: revision.reason == null ? null : String(revision.reason),
            revisionNumber: Number(revision.revision_number ?? 0),
          }
        }),
        status: String(
          item.status ?? 'accepted',
        ) as AdminLectureSummary['status'],
        windowEnd: String(item.window_end ?? ''),
        windowIndex: Number(item.window_index ?? 0),
        windowStart: String(item.window_start ?? ''),
      }
    }),
    windows: (raw?.windows ?? []).map((item) => ({
      attemptCount: Number(item.attempt_count ?? 0),
      id: String(item.id ?? ''),
      lastErrorCode:
        item.last_error_code == null ? null : String(item.last_error_code),
      status: String(item.status ?? 'pending'),
      windowEnd: String(item.window_end ?? ''),
      windowIndex: Number(item.window_index ?? 0),
      windowStart: String(item.window_start ?? ''),
    })),
  }
}
