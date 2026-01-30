import { useState, useEffect, useCallback, createContext, useContext } from 'react';

interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  text: string;
}

interface ToastContextType {
  toast: (type: ToastMessage['type'], text: string) => void;
}

const ToastContext = createContext<ToastContextType>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const toast = useCallback((type: ToastMessage['type'], text: string) => {
    const id = nextId++;
    setMessages((prev) => [...prev, { id, type, text }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {messages.map((msg) => (
          <ToastItem key={msg.id} message={msg} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  message,
  onDismiss,
}: {
  message: ToastMessage;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(message.id), 4000);
    return () => clearTimeout(timer);
  }, [message.id, onDismiss]);

  const bgColor =
    message.type === 'success'
      ? 'bg-green-600'
      : message.type === 'error'
        ? 'bg-red-600'
        : 'bg-blue-600';

  return (
    <div
      className={`${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between gap-3 animate-slide-in`}
    >
      <span className="text-sm">{message.text}</span>
      <button
        onClick={() => onDismiss(message.id)}
        className="text-white/80 hover:text-white text-lg leading-none"
      >
        &times;
      </button>
    </div>
  );
}
