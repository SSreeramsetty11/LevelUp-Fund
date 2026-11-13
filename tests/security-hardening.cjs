const {PGlite}=require('@electric-sql/pglite');
const fs=require('fs'), assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated; grant usage on schema public to anon, authenticated;`);
 for(const f of ['202611100001_shared_admin.sql','202611110001_age_confirmation.sql','202611130001_household_income.sql']) await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 const admin='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 await db.exec(`insert into auth.users(id) values ('${admin}'),('${other}'); insert into public.levelup_admins(user_id) values ('${admin}'); insert into public.levelup_team(name,role,bio,image) values ('Old','Role','Bio','legacy-image');`);
 await db.exec(fs.readFileSync('supabase/migrations/202611130003_security_hardening.sql','utf8'));
 // The security migration may be applied before stage 2 without breaking the
 // currently deployed form. Running it twice is safe. Stage 2 then requires income.
 await db.exec(`set role anon; insert into public.levelup_applications(name,email,exam_provider,certification,certification_url,essay,amount,agreement,age_confirmed) values ('Old test','sample@example.com','Board','Cert','https://example.com','Sample essay',100,true,true); reset role;`);
 await db.exec(fs.readFileSync('supabase/migrations/202611130003_security_hardening.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/202611130002_require_household_income.sql','utf8'));
 const cols='name,email,exam_provider,certification,certification_url,essay,amount,agreement,age_confirmed,household_income';
 function vals({name='Sample',email='sample@example.com',url='https://example.com/certification',essay='Sample essay',amount='400',income='50000'}={}) { return `'${name}','${email}','Board','Cert','${url}','${essay}',${amount},true,true,${income}`; }
 async function denied(sql,pattern){let caught=false;try{await db.exec(sql)}catch(e){caught=true;if(pattern)assert.match(e.message,pattern)}finally{await db.exec('reset role;')}assert(caught,'expected denial');}
 const anon='set role anon;'; const adminRole=`set role authenticated; select set_config('request.jwt.claim.sub','${admin}',false);`; const nonAdmin=`set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`;
 await denied(`${anon} insert into public.levelup_applications(name,email,exam_provider,certification,certification_url,essay,amount,agreement,age_confirmed) values ('Sample','sample@example.com','Board','Cert','https://example.com','Essay',100,true,true);`,/row-level security/i);
 await db.exec(`${anon} insert into public.levelup_applications(${cols}) values (${vals()}); reset role;`);
 await denied(`${anon} insert into public.levelup_applications(${cols}) values (${vals({email:'invalid'})});`,/email/i);
 await denied(`${anon} insert into public.levelup_applications(${cols}) values (${vals({url:'javascript:alert(1)'})});`,/URL/i);
 await denied(`${anon} insert into public.levelup_applications(${cols}) values (${vals({url:'https://user:secret@example.com'})});`,/URL/i);
 await denied(`${anon} insert into public.levelup_applications(${cols}) values (${vals({url:'https://example.com/has space'})});`,/URL/i);
 await denied(`${anon} insert into public.levelup_applications(${cols}) values (${vals({essay:'word '.repeat(500)})});`,/500 words/i);
 await db.exec(`${anon} insert into public.levelup_applications(${cols}) values (${vals({essay:'word '.repeat(499),url:'https://example.com/test?x=1#section'})}); reset role;`);
 await denied(`${anon} insert into public.levelup_applications(${cols},status) values (${vals()},'Approved');`,/permission denied/i);
 await denied(`${anon} select * from public.levelup_applications;`,/permission denied/i);
 await db.exec(nonAdmin); const nonAdminRows=await db.query('select id from public.levelup_applications');assert.equal(nonAdminRows.rows.length,0); await db.exec('reset role;');
 await db.exec(nonAdmin); const nonAdminUpdate=await db.query("update public.levelup_applications set status='Rejected' returning id"); assert.equal(nonAdminUpdate.rows.length,0); await db.exec('reset role;');
 await denied(`${adminRole} update public.levelup_applications set household_income=0;`,/permission denied/i);
 await denied(`${adminRole} update public.levelup_applications set name='Changed';`,/permission denied/i);
 await db.exec(`${adminRole} update public.levelup_applications set notes='reviewed', status='In review'; reset role;`);
 await db.exec(`${adminRole} update public.levelup_team set bio='Edited' where name='Old'; reset role;`);
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X5/0AAAAASUVORK5CYII=';
 await db.exec(`${adminRole} insert into public.levelup_team(name,role,bio,image) values ('Test','Role','Bio','${png}'); insert into public.levelup_team(name,role,bio,image) values ('No photo','Role','Bio',''); insert into public.levelup_sponsors(name,image) values ('Example','${png}'); reset role;`);
 await denied(`${adminRole} insert into public.levelup_team(name,role,bio,image) values ('Test','Role','Bio','data:image/svg+xml;base64,PHN2Zz4=');`,/PNG, JPEG, or WebP/i);
 await denied(`${adminRole} insert into public.levelup_sponsors(name,image) values ('Fake','data:image/png;base64,SGVsbG8=');`,/does not match/i);
 await denied(`${adminRole} insert into public.levelup_sponsors(name,image) values ('Blank','');`,/PNG, JPEG, or WebP/i);
 await denied(`${adminRole} insert into public.levelup_sponsors(name,image) values ('Too big','data:image/png;base64,' || replace(encode(decode('89504e470d0a1a0a','hex') || decode(repeat('00',512000),'hex'),'base64'), E'\n',''));`,/500 KB/i);
 console.log('Security migration passed: roles, review-only updates, input validation, legacy edits, image types, signatures and size limits.');
 await db.close();
})().catch(e=>{console.error(e);process.exit(1)});
