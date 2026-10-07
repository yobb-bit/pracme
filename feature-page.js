/* Load the shared question screen, then start it in the mode for this page. */
import './nav.js';
import { Battle } from './battle.js';

async function startPage(){
  const mode=document.body.dataset.mode==='practice'?'practice':'boss';
  const root=document.getElementById('app-root');

  try{
    const response=await fetch('feature-ui.html');
    if(!response.ok) throw new Error(`Could not load practice screen (${response.status}).`);
    root.innerHTML=await response.text();

    const heading=document.querySelector('.app__header h1');
    if(heading) heading.textContent=mode==='boss'?'Interview Quiz':'Free Practice';
    document.title=mode==='boss'?'Interview Quiz':'Free Practice';
    window.APP_MODE=mode;

    // Set the mode before app.js wires its controls and starts the question round.
    Battle.setMode(mode);
    if (mode === 'boss' && new URLSearchParams(location.search).get('guideFight') === '1') {
      Battle.selectVillain('easy');
    }

    // The 3D library and arena are only loaded on the Quiz page.
    if(mode==='boss') await import('./arena.js');
    await import('./app.js');
  }catch(error){
    console.error(error);
    root.textContent='This page could not load. Serve the project over HTTP and try again.';
  }
}

startPage();
