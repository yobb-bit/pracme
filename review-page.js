/* Review the saved questions without starting a quiz or changing battle state. */
import './nav.js';

const RESULTS_KEY = 'interview-practice.data.v1';
const list = document.getElementById('review-list');
const topicFilter = document.getElementById('topic-filter');
const empty = document.getElementById('review-empty');
const status = document.getElementById('review-status');
const practiceButton = document.getElementById('practice-these');

let questions = [];
let savedStats = {};
let visibleItems = [];

function loadStats(){
  try{
    const saved=JSON.parse(localStorage.getItem(RESULTS_KEY)||'{}');
    return saved.stats&&typeof saved.stats==='object'?saved.stats:{};
  }catch(error){
    console.warn('[review] Could not read saved practice results:',error);
    return {};
  }
}

function section(title,value){
  const block=document.createElement('section');
  block.className='review__section';
  const heading=document.createElement('h3');
  heading.textContent=title;
  const body=document.createElement('p');
  body.textContent=value||'No notes have been added for this question yet.';
  block.append(heading,body);
  return block;
}

function cardFor(question,stats){
  const item=document.createElement('li');
  item.className='review__item';
  const tags=document.createElement('p');
  tags.className='tags';
  for(const value of [question.category,question.difficulty,question.type]){
    const badge=document.createElement('span');
    badge.className='badge';
    badge.textContent=value||'General';
    tags.append(badge);
  }

  const heading=document.createElement('h2');
  heading.className='review__q';
  heading.textContent=question.question||'Question';
  const meta=document.createElement('p');
  meta.className='review-page__meta';
  meta.textContent=`Missed ${stats.timesMissed||0} time${stats.timesMissed===1?'':'s'} · Last rated ${stats.lastResult||'partly'}`;
  item.append(tags,heading,meta,
    section('Analogy',question.analogy),
    section('Model answer',question.modelAnswer),
    section('Example',question.example),
    section('Follow-up question',question.followUp));
  return item;
}

function render(){
  const topic=topicFilter.value;
  visibleItems=questions
    .map(question=>({question,stats:savedStats[question.id]||{}}))
    .filter(({question,stats})=>(stats.timesMissed>0||stats.lastResult==='partly')&&(topic==='All'||question.category===topic))
    .sort((a,b)=>(b.stats.timesMissed||0)-(a.stats.timesMissed||0)||(b.stats.timesSeen||0)-(a.stats.timesSeen||0)||a.question.question.localeCompare(b.question.question));

  list.replaceChildren(...visibleItems.map(({question,stats})=>cardFor(question,stats)));
  const hasAny=questions.some(question=>{
    const stats=savedStats[question.id]||{};
    return stats.timesMissed>0||stats.lastResult==='partly';
  });
  empty.hidden=hasAny;
  status.textContent=hasAny?`${visibleItems.length} question${visibleItems.length===1?'':'s'} to review${topic==='All'?'':` in ${topic}`}.`:'';
  practiceButton.disabled=visibleItems.length===0;
}

async function start(){
  try{
    const response=await fetch('questions.json');
    if(!response.ok) throw new Error(`Question data could not be loaded (${response.status}).`);
    const data=await response.json();
    if(!Array.isArray(data)) throw new Error('Question data has an unexpected format.');
    questions=data;
    savedStats=loadStats();

    [...new Set(questions.map(question=>question.category).filter(Boolean))].sort().forEach(topic=>{
      const option=document.createElement('option');
      option.value=topic; option.textContent=topic;
      topicFilter.append(option);
    });

    topicFilter.addEventListener('change',render);
    practiceButton.addEventListener('click',()=>{
      const ids=visibleItems.map(item=>item.question.id).filter(Boolean);
      if(!ids.length) return;
      window.location.href=`practice.html?questions=${encodeURIComponent(ids.join(','))}`;
    });
    render();
  }catch(error){
    console.error(error);
    status.textContent='Could not load the review list. Serve the project over HTTP and try again.';
  }
}

start();
