import { CheckmarkCircle02Icon } from '@/components/core/icons'
import type { ToolCallInfo, ToolResultInfo } from '@/lib/conversations/segments'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'

/**
 * ask_user question card, answered state. In demo data every ask has already
 * been answered, so this renders question + chosen answer parsed from the
 * plugin's stable output format ("Answer: …" lines); when the output doesn't
 * parse, the raw output is shown — same fallback as the desktop.
 */

type Question = {
  question: string
  details?: string
  options?: Array<{ label: string; description?: string }>
}

function parseQuestions(call: ToolCallInfo): Question[] {
  const raw = call.args.questions
  if (!Array.isArray(raw)) {
    const single = call.args.question
    return typeof single === 'string' ? [{ question: single }] : []
  }
  return raw
    .map((entry) => {
      if (typeof entry === 'string') return { question: entry }
      if (entry && typeof entry === 'object' && typeof (entry as Question).question === 'string') {
        return entry as Question
      }
      return null
    })
    .filter((entry): entry is Question => entry !== null)
}

/** The ask plugin prints answers as "Answer: <text>" / numbered lines. */
function parseAnswers(output: string): string[] {
  const answers: string[] = []
  for (const line of output.split('\n')) {
    const match = /^\s*(?:\d+[.)]\s*)?Answer(?:\s+\d+)?\s*[:：]\s*(.+)$/i.exec(line)
    if (match) answers.push(match[1].trim())
  }
  return answers
}

export type QuestionCardProps = {
  call: ToolCallInfo
  result?: ToolResultInfo
}

export const QuestionCard = memo(function QuestionCard({
  call,
  result
}: QuestionCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const questions = parseQuestions(call)
  const answers = result ? parseAnswers(result.output) : []

  return (
    <View className="bg-surface border-border w-full flex-col gap-3 self-start rounded-2xl border p-4">
      {questions.map((question, index) => (
        <View key={index} className="flex-col gap-1.5">
          <Text className="text-fg font-sans-semibold text-left text-sm">{question.question}</Text>
          {question.details ? (
            <Text className="text-muted text-left font-sans text-xs leading-5">
              {question.details}
            </Text>
          ) : null}
          {answers[index] ? (
            <View className="flex-row items-center gap-2 pt-1">
              <CheckmarkCircle02Icon size={14} className="text-emerald-600" />
              <Text className="text-fg font-sans-medium flex-1 text-left text-sm">
                {answers[index]}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
      {answers.length === 0 && result?.output ? (
        <View className="flex-col gap-1">
          <Text className="text-muted font-sans-medium text-left text-[10px]">
            {t('chat.questionCard.yourAnswer')}
          </Text>
          <Text className="text-fg text-left font-sans text-xs leading-5" numberOfLines={6}>
            {result.output.trim()}
          </Text>
        </View>
      ) : null}
    </View>
  )
})
