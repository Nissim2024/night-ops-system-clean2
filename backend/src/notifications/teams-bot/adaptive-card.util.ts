const STATUS_LABEL: Record<string, string> = {
  WAITING: 'ממתין',
  OPEN: 'פתוח',
  IN_PROGRESS: 'בביצוע',
  BLOCKED: 'חסום',
  DONE: 'הושלם',
  FAILED: 'נכשל',
  ROLLED_BACK: 'בוטל',
};

// Adaptive Card v1.4, rendered inside Microsoft Teams via the Bot Framework.
// Action.Execute round-trips through POST /notifications/teams/bot/messages
// as an `adaptiveCard/action` invoke activity — see teams-bot.service.ts.
export function buildTaskActionCard(task: any, message?: string) {
  const body: any[] = [];

  if (message) {
    body.push({ type: 'TextBlock', text: message, wrap: true, weight: 'bolder' });
  }

  if (task) {
    body.push(
      { type: 'TextBlock', text: task.title, wrap: true, size: 'medium', weight: 'bolder' },
      {
        type: 'FactSet',
        facts: [
          task.crNumber ? { title: 'CR', value: String(task.crNumber) } : undefined,
          task.assignedTeam?.name ? { title: 'צוות', value: task.assignedTeam.name } : undefined,
          { title: 'סטטוס', value: STATUS_LABEL[task.status] ?? task.status },
        ].filter(Boolean),
      },
    );

    const actions: any[] = [];
    if (['WAITING', 'OPEN'].includes(task.status)) {
      actions.push({ type: 'Action.Execute', title: '▶ התחל', verb: 'taskAction', data: { taskId: task.id, action: 'start' } });
    }
    if (task.status === 'IN_PROGRESS') {
      actions.push({ type: 'Action.Execute', title: '✅ סיים', verb: 'taskAction', data: { taskId: task.id, action: 'complete' } });
    }
    if (!['DONE', 'FAILED', 'ROLLED_BACK'].includes(task.status)) {
      actions.push({ type: 'Action.Execute', title: '⛔ חסום', verb: 'taskAction', data: { taskId: task.id, action: 'block' } });
    }

    return {
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      type: 'AdaptiveCard',
      version: '1.4',
      body,
      actions,
    };
  }

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body,
    actions: [],
  };
}
