import { runAgent, type AgentEvents, type AgentMessage, type ProviderConfig } from './providers'
import { executeTool, TOOL_DEFS, buildSceneContext, captureViewport } from './tools'
import { judgeShot } from './codeJudge'
import {
  parseShotPlanFromText,
  planNeedsObjectPhase,
  resolveSubjectId,
  retargetPlanSubjectAfterLift,
} from './parseShotPlan'
import { buildJudgeInput, formatJudgeReport, objectCandidates, selectedObjectId } from './sceneSnapshot'
import { skillBodiesForPlan } from './skills'
import { failChipsFor, parseVisionJudge, visionJudgeSystemPrompt } from './visionJudge'
import { phaseStatus, toolsForPhase, type CompilerPhase } from './toolPhases'
import type { JudgeBlame, ShotPlan } from './shotTypes'
import { useRigStore } from '../../state/useRigStore'
import { applyBeginPlayback } from '../playback'
import { cameraAnchorCount } from '../../state/cameraPathLink'

const MAX_CYCLES = 2
const OBJECT_TURNS = 8
const CAMERA_TURNS = 12

export type CompilerEvents = AgentEvents & {
  onProgress?: (label: string) => void
}

export type CompilerResult = {
  messages: AgentMessage[]
  plan: ShotPlan | null
  passed: boolean
  failChips: string[]
  retried: boolean
  askUser?: string
}

export async function runShotCompiler(opts: {
  provider: ProviderConfig
  system: string
  messages: AgentMessage[]
  userText: string
  hasImage?: boolean
  signal?: AbortSignal
  events?: CompilerEvents
}): Promise<CompilerResult> {
  const candidates = objectCandidates()
  const resolved = resolveSubjectId(opts.userText, candidates, selectedObjectId())
  if (resolved.ambiguous && !opts.hasImage) {
    return {
      messages: [
        ...opts.messages,
        {
          role: 'assistant',
          text: 'Which object is the subject of this shot?',
          toolCalls: [],
        },
      ],
      plan: null,
      passed: false,
      failChips: [],
      retried: false,
      askUser: 'Which object is the subject of this shot?',
    }
  }

  const subjectId = resolved.subjectId ?? candidates[0]?.id ?? ''
  let plan = parseShotPlanFromText(opts.userText, subjectId)
  let messages = injectPlan(opts.messages, plan)
  let lastBlame: JudgeBlame = 'camera'
  let lastCodes: string[] = []
  let passed = false
  let retried = false

  const runPhase = async (phase: CompilerPhase, extra?: string) => {
    opts.events?.onProgress?.(phaseStatus(phase))
    const phaseMessages = extra
      ? [...messages, { role: 'user' as const, text: extra }]
      : messages
    const result = await runAgent({
      provider: opts.provider,
      system: phaseSystem(opts.system, phase, plan),
      messages: phaseMessages,
      tools: toolsForPhase(TOOL_DEFS, phase, plan),
      execute: executeTool,
      signal: opts.signal,
      maxTurns: phase === 'object' ? OBJECT_TURNS : CAMERA_TURNS,
      events: opts.events,
    })
    messages = result.messages
    return result
  }

  for (let cycle = 0; cycle < MAX_CYCLES; cycle++) {
    const runObjects =
      (cycle === 0 &&
        (opts.hasImage || planNeedsObjectPhase(plan, opts.userText))) ||
      (cycle > 0 && lastBlame === 'object')
    if (runObjects) {
      const idsBeforeLift = new Set(objectCandidates().map((o) => o.id))
      const objectPhaseFrom = messages.length
      await runPhase(
        'object',
        snapshotUser(
          objectPhaseInstruction({
            hasImage: Boolean(opts.hasImage),
            cycle,
            subjectId: plan.subject_id,
          }),
        ),
      )
      const liftFail = liftToolFailure(messages.slice(objectPhaseFrom))
      if (liftFail) {
        messages = [
          ...messages,
          { role: 'assistant', text: liftFail, toolCalls: [] },
        ]
        return {
          messages,
          plan,
          passed: false,
          failChips: [],
          retried,
        }
      }
      if (opts.hasImage && cycle === 0) {
        plan = retargetPlanSubjectAfterLift(plan, idsBeforeLift, objectCandidates())
      }
    }

    await runPhase(
      'camera',
      snapshotUser(
        cycle === 0
          ? `Phase: camera. Subject is ${plan.subject_id}. Scale ${plan.shot_scale}, angle ${plan.angle}, move ${plan.move_kind}, duration ${plan.duration_s}s. Call instantiate_atom with those fields (kind=${plan.move_kind === 'custom' ? 'orbit' : plan.move_kind}). Do not invent XYZ anchors. Then stop.`
          : `Retry camera. Judge: ${lastCodes.join(', ')}. Subject ${plan.subject_id}. Call instantiate_atom again with a tighter/wider scale if framing failed.`,
      ),
    )

    opts.events?.onProgress?.('Checking shot…')
    const report = judgeShot(buildJudgeInput(plan))
    lastCodes = report.failures.map((f) => f.code)
    lastBlame = report.blame ?? 'camera'
    if (report.pass) {
      if (opts.provider.vision) {
        const vision = await runVisionJudge(opts, messages, plan)
        messages = vision.messages
        if (!vision.pass) {
          lastBlame = vision.blame
          lastCodes = ['vision']
          if (cycle + 1 >= MAX_CYCLES) break
          retried = true
          continue
        }
      }
      passed = true
      break
    }

    if (cycle + 1 >= MAX_CYCLES) break
    retried = true
    messages = [
      ...messages,
      {
        role: 'user',
        text: snapshotUser(
          `Code judge FAILED (blame ${lastBlame}). Fix only this:\n${formatJudgeReport(report)}\nOne retry.`,
        ),
      },
    ]
  }

  if (passed && cameraAnchorCount() >= 2) {
    useRigStore.getState().setT(0)
    applyBeginPlayback()
  }

  return {
    messages,
    plan,
    passed,
    failChips: passed ? [] : failChipsFor(lastCodes),
    retried,
  }
}

const LIFT_TOOLS = new Set(['block_people_from_image', 'generate_prop'])

/** Last lift-tool result in this slice, if it did not place an object. */
export function liftToolFailure(messages: AgentMessage[]): string | null {
  let last: string | null = null
  for (const message of messages) {
    if (message.role !== 'tool' || !LIFT_TOOLS.has(message.name)) continue
    last = message.content
  }
  if (last === null) return null
  if (last.startsWith('Placed ')) return null
  if (last.startsWith('Error:')) return last.replace(/^Error:\s*/, '')
  return last
}

export function objectPhaseInstruction(opts: {
  hasImage: boolean
  cycle: number
  subjectId: string
}): string {
  if (opts.hasImage && opts.cycle === 0) {
    return 'Phase: objects. The image on this turn is the chat photo — not the 3D viewport. Ignore torus knot / primitives in scene_state. If the user wants people posed or retried from that still, call block_people_from_image now (SAM 3.1 then one 3D Body GLB per person). A new lift replaces the last people imports. After the lift returns ids, pose_object each person separately if they asked to pose/arrange them. Never pose objects that were already in the scene. Then stop.'
  }
  return `Phase: objects. Subject is ${opts.subjectId}. Use object tools only. Then stop.`
}

function phaseSystem(base: string, phase: CompilerPhase, plan: ShotPlan): string {
  const loaded = skillBodiesForPlan(plan, phase)
  return `${base}

## Shot compiler
You are the Director. The user never sees this plan JSON. Follow the current phase.
ShotPlan: ${JSON.stringify(plan)}
Phase: ${phase} — only call tools listed for this phase. Do not narrate crew names.
When the phase work is done, stop (no more tools). Keep any spoken text to one short sentence.
${loaded ? `\n## Loaded skill\n${loaded}` : ''}`
}

function injectPlan(messages: AgentMessage[], plan: ShotPlan): AgentMessage[] {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') return messages
  return [
    ...messages.slice(0, -1),
    { ...last, text: `${last.text}\n\n<shot_plan>\n${JSON.stringify(plan, null, 1)}\n</shot_plan>` },
  ]
}

function snapshotUser(instruction: string): string {
  return `<scene_state>\n${buildSceneContext()}\n</scene_state>\n\n${instruction}`
}

async function runVisionJudge(
  opts: {
    provider: ProviderConfig
    system: string
    signal?: AbortSignal
    events?: CompilerEvents
  },
  messages: AgentMessage[],
  plan: ShotPlan,
): Promise<{ messages: AgentMessage[]; pass: boolean; blame: JudgeBlame }> {
  const stills: string[] = []
  const rig = useRigStore.getState()
  for (const t of [0, 0.5, 1] as const) {
    rig.setPlaying(false)
    rig.setT(t)
    const jpeg = captureViewport()
    if (jpeg) stills.push(jpeg)
  }
  if (stills.length === 0) {
    return {
      messages,
      pass: false,
      blame: 'camera',
    }
  }
  const visionMessages: AgentMessage[] = [
    ...messages,
    {
      role: 'user',
      text: `Intent: ${plan.intent}\nScale: ${plan.shot_scale}. Check all three stills (start, mid, end).`,
      image: stills[1] ?? stills[0],
      images: stills,
    },
  ]
  const result = await runAgent({
    provider: { ...opts.provider, vision: true },
    system: visionJudgeSystemPrompt(),
    messages: visionMessages,
    tools: [],
    execute: async () => '',
    signal: opts.signal,
    maxTurns: 1,
    events: opts.events,
  })
  const last = result.messages.at(-1)
  const text = last && last.role === 'assistant' ? last.text : ''
  const parsed = parseVisionJudge(text)
  return { messages: result.messages, pass: parsed.pass, blame: parsed.blame }
}
