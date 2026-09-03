import { describe, expect, it } from 'vitest'
import {
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import {
  KNOWN_SESSION_EVENT_TYPES,
  Session,
  SessionId,
} from '@deepseek-ai/dsh-session'
import {
  appendWindowTeamState,
  foldWindowTeam,
  type WindowTeamProjection,
  windowTeamProjectionDefinition,
} from '../src/index.ts'

function team(revision: number, status: WindowTeamProjection['tasks'][number]['status']): WindowTeamProjection {
  return {
    teamId: 'team-12345678',
    revision,
    goal: 'ship the feature',
    leaderSessionId: 'leader',
    leaderName: 'Product',
    leaderRole: 'product lead',
    members: [{ sessionId: 'member', name: 'Development', role: 'developer', created: true }],
    tasks: [{
      id: 'task-development',
      title: 'Develop',
      instruction: 'Implement the feature',
      ownerSessionId: 'member',
      ownerName: 'Development',
      dependsOn: [],
      status,
      attempts: 1,
      maxAttempts: 2,
      note: null,
      failureKind: null,
    }],
  }
}

describe('window team state snapshots', () => {
  it('persists known alpha.4 team records without changing the model surface', () => {
    const session = Session.create(SessionId('leader'))
    const generation = session.surface.replaceGeneration
    appendWindowTeamState(session, team(1, 'running'))
    appendWindowTeamState(session, team(2, 'completed'))

    const events = session.snapshotEvents()
    expect(events).toHaveLength(2)
    expect(events.every(event => KNOWN_SESSION_EVENT_TYPES.has(event.type))).toBe(true)
    expect(events.map(event => event.type)).toEqual(['team/task', 'team/task'])
    expect(events.every(event => !('surfaceOp' in event))).toBe(true)
    expect(session.surface.nodes).toEqual([])
    expect(session.surface.replaceGeneration).toBe(generation)
    expect(foldWindowTeam(events)).toEqual(team(2, 'completed'))
    expect(windowTeamProjectionDefinition.stateVersion).toBe(2)

    const restored = Session.create(SessionId('leader'), events)
    expect(restored.surface.nodes).toEqual([])
    expect(foldWindowTeam(restored.snapshotEvents())).toEqual(team(2, 'completed'))
  })

  it('reads an earlier visible snapshot without replacing or deleting it', () => {
    const session = Session.create(SessionId('leader'))
    const first = team(1, 'running')
    session.append('user/message', createUserMessage({
      content: [{
        type: 'text',
        text: `Current window team state. This snapshot supersedes earlier window-team snapshots.\n\n${JSON.stringify(first)}`,
      }],
      source: {
        kind: 'plugin',
        plugin: '@vibeinging/dsh-session-teams',
        form: 'snapshot',
        sections: [{ name: 'window team', text: JSON.stringify(first) }],
      },
    }), { surfaceOp: 'append' })
    const nodes = [...session.surface.nodes]
    const generation = session.surface.replaceGeneration

    appendWindowTeamState(session, team(2, 'completed'))

    expect(session.snapshotEvents().map(event => event.type)).toEqual(['user/message', 'team/task'])
    expect(session.surface.nodes).toEqual(nodes)
    expect(session.surface.replaceGeneration).toBe(generation)
    expect(foldWindowTeam(session.snapshotEvents())).toEqual(team(2, 'completed'))
  })
})
