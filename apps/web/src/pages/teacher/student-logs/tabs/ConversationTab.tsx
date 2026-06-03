export function ConversationTab({ logs }: { logs: any[] }) {
  const CHAT_ACTIONS = [
    'DIALOGUE_MESSAGE_SENT',
    'DIALOGUE_MESSAGE_RECEIVED',
    'CHATBOT_MESSAGE_SENT',
    'CHATBOT_MESSAGE_RECEIVED',
  ];
  const messages = logs
    .filter((l) => CHAT_ACTIONS.includes(l.action))
    .map((l) => {
      const meta = (l.metadata as Record<string, unknown> | null) ?? {};
      // Role: derive from the action when metadata.role is absent.
      const role =
        (typeof meta.role === 'string' && meta.role) ||
        (l.action.endsWith('_SENT') ? 'student' : 'assistant');
      // Text: dialogue mode stores `messageText`; standard-mode chatbot
      // stores `message` (sent) or `reply` (received).
      const text =
        (typeof meta.messageText === 'string' && meta.messageText) ||
        (typeof meta.message === 'string' && meta.message) ||
        (typeof meta.reply === 'string' && meta.reply) ||
        '';
      return {
        id: l.id,
        role,
        text,
        timestamp: l.occurredAt,
        dialogueSessionId: l.dialogueSessionId,
        action: l.action,
      };
    });

  if (messages.length === 0) {
    return <p className="text-xs text-gray-400">No conversation history in this session.</p>;
  }

  let lastSession: string | null = null;

  return (
    <div className="space-y-2">
      {messages.map((m) => {
        const isSessionBreak = m.dialogueSessionId !== lastSession;
        lastSession = m.dialogueSessionId;
        return (
          <div key={m.id}>
            {isSessionBreak && (
              <p className="text-[10px] text-gray-400 text-center my-3 font-mono">
                — dialogue session {m.dialogueSessionId?.slice(0, 8)} —
              </p>
            )}
            <div className={`flex ${m.role === 'student' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'student'
                    ? 'bg-indigo-500 text-white rounded-br-sm'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-sm'
                }`}
              >
                {m.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
