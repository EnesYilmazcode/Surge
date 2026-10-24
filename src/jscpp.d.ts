declare module 'JSCPP' {
  const JSCPP: { run(code: string, input: string, config?: Record<string, unknown>): number }
  export default JSCPP
}
