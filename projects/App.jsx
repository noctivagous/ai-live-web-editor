export default function App(){
  return <div style={{padding:24}}>
    <h1>Real FS works ⚡</h1>
    <p>This file lives at <code>projects/App.jsx</code> on your real disk.</p>
    <p>Edit it in the launcher UI or ask AI: "make this a todo app"</p>
    <p>When AI writes, it calls <code>fs.writeFileSync</code> then <code>page.$eval</code> to patch DOM in 5ms - no screenshot tax.</p>
    <div style={{marginTop:24,padding:16,background:'#f5f5f5',borderRadius:8}}>
      <b>Try:</b> Ask AI "Add a counter button that increments"
    </div>
  </div>
}
