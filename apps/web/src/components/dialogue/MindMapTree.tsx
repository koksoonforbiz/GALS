interface MindMapNode {
  id: string;
  label: string;
  parentId: string | null;
  level: number;
}

interface MindMapTreeProps {
  root: string;
  nodes: MindMapNode[];
}

function TreeNode({ node, children }: { node: MindMapNode; children: MindMapNode[] }) {
  const directChildren = children.filter((c) => c.parentId === node.id);

  return (
    <div className="ml-4">
      <div className="flex items-center gap-2 py-1">
        <span
          className={`w-2 h-2 rounded-full ${
            node.level === 0
              ? 'bg-blue-500'
              : node.level === 1
                ? 'bg-green-500'
                : node.level === 2
                  ? 'bg-yellow-500'
                  : 'bg-gray-400'
          }`}
        />
        <span className={`text-sm ${node.level === 0 ? 'font-semibold' : ''}`}>{node.label}</span>
      </div>
      {directChildren.length > 0 && (
        <div className="border-l border-gray-200 ml-1">
          {directChildren.map((child) => (
            <TreeNode key={child.id} node={child} children={children} />
          ))}
        </div>
      )}
    </div>
  );
}

export function MindMapTree({ root, nodes }: MindMapTreeProps) {
  const rootNodes = nodes.filter((n) => n.parentId === null);

  return (
    <div className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-3 h-3 rounded-full bg-blue-600" />
        <span className="font-bold text-base">{root}</span>
      </div>
      <div className="border-l-2 border-blue-200 ml-1.5">
        {rootNodes.map((node) => (
          <TreeNode key={node.id} node={node} children={nodes} />
        ))}
      </div>
    </div>
  );
}
