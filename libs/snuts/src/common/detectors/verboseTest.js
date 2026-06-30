import traverse from "@babel/traverse";
const traverseDefault =
  typeof traverse === "function" ? traverse : traverse.default;

const detectVerboseStatement = (ast) => {
  const smells = [];
  traverseDefault(ast, {
    BlockStatement(path) {
      const { loc } = path.node;
      if (path.node.body.length > 13) {
        smells.push({
          startLine: loc.start.line,
          endLine: loc.end.line,
        });
      }
    },
  });
  return smells;
};

export default detectVerboseStatement;
