import traverse from "@babel/traverse";
const traverseDefault =
  typeof traverse === "function" ? traverse : traverse.default;

const detectConditionalTestLogic = (ast) => {
  const smells = [];
  traverseDefault(ast, {
    IfStatement: ({ node }) => {
      const loc = node.loc;
      smells.push({ startLine: loc.start.line, endLine: loc.end.line });
    },
  });
  return smells;
};

export default detectConditionalTestLogic;
