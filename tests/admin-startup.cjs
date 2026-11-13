const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
const bootstrap = html.match(/<!-- Explain startup problems even when the admin module cannot load\. -->\s*<script>([\s\S]*?)<\/script>/)[1];
const adminModule = html.match(/<script type="module">\s*import \{ createClient \}([\s\S]*?)<\/script>/)[1].replace(/^.*?;\s*/,'').replace(/^\s*import .*;\s*$/gm,'');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);

class Element {
  constructor(id) {
    this.id=id; this.dataset={}; this.hidden=false; this.textContent=''; this.value=''; this.listeners={}; this.style={};
    this.validity={valid:true}; this.classList={add(){},remove(){},toggle(){}}; this.files=[]; this.children=[];
  }
  addEventListener(type, fn){ (this.listeners[type] ||= []).push(fn); }
  async dispatch(type, event={}) { event.preventDefault ||= ()=>{}; event.currentTarget=this; for (const cb of this.listeners[type] || []) await cb(event); }
  focus() { this.focused=true; } reset() {} showModal() { this.open=true; } close() { this.open=false; }
  querySelectorAll() { return []; } querySelector() { return this.submitButton ||= {disabled:false}; }
  replaceChildren(...children) { this.children=children; } append(...children) { this.children.push(...children); }
  setAttribute() {} removeAttribute() {} scrollBy() {}
}
function setup(protocol='http:', allowed=true, challenge={ok:true}) {
  const elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));
  const document={getElementById:id=>elements[id] || null,createElement:tag=>new Element(tag),body:{style:{}},hidden:false};
  let signedIn, resets=0;
  const backend={
    async signIn(email,password,token){ signedIn={email,password,token}; if (!allowed) throw Error('denied'); },
    async signOut(){}, async listApplications(){return []}, async listTeam(){return []}, async listSponsors(){return []}
  };
  const ctx={document,window:{location:{protocol,href:'http://localhost:5500/index.html'},matchMedia:()=>({matches:false})},
    createClient:()=>({auth:{}}),createSharedAdmin:()=>backend,SUPABASE_URL:'x',SUPABASE_PUBLISHABLE_KEY:'x',TURNSTILE_SITE_KEY:'',createAuthCaptcha:()=>({prepare(){},consume(){return challenge},reset(){resets++}}),
    setInterval(){},clearTimeout(){},setTimeout(){},Date,Number,URL,console,Intl};
  vm.runInNewContext(bootstrap,ctx);
  return {elements,ctx,getSignedIn:()=>signedIn,getResets:()=>resets};
}
(async()=>{
  let s=setup('file:');
  await s.elements['open-admin'].dispatch('click');
  assert.equal(s.elements['admin-load-status'].hidden,false);
  assert.match(s.elements['admin-load-status'].textContent,/local server.*Live Server/);
  assert(!s.elements['admin-login-dialog'].open);
  s=setup('http:');
  await s.elements['open-admin'].dispatch('click');
  assert.match(s.elements['admin-load-status'].textContent,/connection.*refresh/);
  vm.runInNewContext(adminModule,s.ctx);
  assert.equal(s.elements['open-admin'].dataset.adminReady,'true');
  assert.equal(s.elements['admin-load-status'].hidden,true);
  await s.elements['open-admin'].dispatch('click');
  assert(s.elements['admin-login-dialog'].open);
  assert(s.elements['admin-email'].focused);
  s.elements['admin-email'].value=' admin@example.com ';
  s.elements['admin-password'].value='test-password';
  await s.elements['admin-login-form'].dispatch('submit');
  assert.equal(s.getSignedIn().email,'admin@example.com');
  assert(s.elements['admin-dashboard'].open);
  assert.equal(s.elements['admin-login-dialog'].open,false);
  s=setup('http:',false);
  vm.runInNewContext(adminModule,s.ctx);
  await s.elements['open-admin'].dispatch('click');
  s.elements['admin-email'].value='not-admin@example.com'; s.elements['admin-password'].value='test-password';
  await s.elements['admin-login-form'].dispatch('submit');
  assert(!s.elements['admin-dashboard'].open);
  assert.match(s.elements['login-error'].textContent,/Unable to sign in/);
  s=setup('http:',true,{ok:false});
  vm.runInNewContext(adminModule,s.ctx);
  await s.elements['open-admin'].dispatch('click');
  await s.elements['admin-login-form'].dispatch('submit');
  assert.equal(s.getSignedIn(),undefined);
  s=setup('http:',true,{ok:true,token:'challenge-token'});
  vm.runInNewContext(adminModule,s.ctx);
  await s.elements['open-admin'].dispatch('click');
  s.elements['admin-email'].value='admin@example.com';
  await s.elements['admin-login-form'].dispatch('submit');
  assert.equal(s.getSignedIn().token,'challenge-token');
  assert.equal(s.getResets(),1);
  s=setup('http:');
  delete s.elements['sponsor-track'];
  assert.throws(()=>vm.runInNewContext(adminModule,s.ctx));
  await s.elements['open-admin'].dispatch('click');
  assert(!s.elements['admin-login-dialog'].open);
  assert.match(s.elements['admin-load-status'].textContent,/has not loaded/);
  console.log('Admin startup checks passed: file/network guidance, successful and rejected login, challenge enforcement, and partial initialization failure.');
})().catch(e=>{console.error(e);process.exit(1)});
