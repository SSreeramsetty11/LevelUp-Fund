const assert=require('node:assert/strict');
const {createClient}=require('@supabase/supabase-js');
(async()=>{
 const requests=[];
 const payload=Buffer.from(JSON.stringify({sub:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
 const jwt='eyJhbGciOiJub25lIn0.'+payload+'.signature';
 async function fakeFetch(input,init={}){
   const u=String(input);const body=init.body?JSON.parse(init.body):null;requests.push({url:u,body});
   const data=u.includes('grant_type=password')?{access_token:jwt,refresh_token:'fake-refresh-token',expires_in:3600,token_type:'bearer',user:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',email:'sample@example.com'}}:{};
   return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 }
 const client=createClient('https://test.example','test-public-key',{global:{fetch:fakeFetch},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const login=await client.auth.signInWithPassword({email:'sample@example.com',password:'test-only',options:{captchaToken:'test-captcha'}});
 assert.equal(login.error,null);assert(login.data.session);
 let request=requests.find(r=>r.url.includes('grant_type=password'));assert.equal(request.body.gotrue_meta_security.captcha_token,'test-captcha');
 assert((await client.auth.getSession()).data.session);
 const reset=await client.auth.resetPasswordForEmail('sample@example.com',{redirectTo:'http://localhost/reset-password.html',captchaToken:'reset-captcha'});
 assert.equal(reset.error,null);request=requests.find(r=>r.url.includes('/recover'));assert.equal(request.body.gotrue_meta_security.captcha_token,'reset-captcha');
 await client.auth.signOut({scope:'local'});assert.equal((await client.auth.getSession()).data.session,null);
 console.log('Supabase 2.50.0 SDK checks passed: in-memory login, captcha forwarding for login and recovery, session and logout.');
})().catch(e=>{console.error(e);process.exit(1)});
