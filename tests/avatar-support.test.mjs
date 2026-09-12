import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldsBay, CentralClient } from '../dist/index.js';
import { WorldClient } from '../dist/server.js';
import { avatarStyleSchema, avatarSupportSchema, characterRecipeSchema } from '../dist/schemas.js';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('avatar support validates both styles, all four combinations, and invalid declarations',()=>{
 for(const support of [[],['low-poly'],['detailed'],['low-poly','detailed']]) assert.deepEqual(avatarSupportSchema.parse(support),support);
 assert.equal(avatarStyleSchema.safeParse('high-poly').success,false);
 assert.equal(avatarSupportSchema.safeParse(['low-poly','low-poly']).success,false);
 assert.equal(avatarSupportSchema.safeParse(['unknown']).success,false);
});
test('current and legacy recipes round-trip beard and independent item colors',()=>{
 const recipe={version:1,packRevision:'a'.repeat(64),rig:'universal-male',parts:{top:'base-light-body',beard:'hair-beard'},colors:{skin:'#aabbcc',hair:'#223344',cloth:'#445566'},partColorModes:{beard:'custom'},partColors:{'base-light-body':{fabric:'#112233',trim:'#abcdef',leather:'#553322'}}};
 assert.deepEqual(characterRecipeSchema.parse(recipe),recipe);
 const {partColors,partColorModes,...legacy}=recipe; delete legacy.parts.beard;
 assert.deepEqual(characterRecipeSchema.parse(legacy),legacy);
 assert.equal(characterRecipeSchema.safeParse({...recipe,partColors:{body:{fabric:'invalid'}}}).success,false);
});
test('browser and server clients retain compatibility flags and discovery preserves explicit none',async()=>{
 const appearance={player:{id:'test',name:'Player',color:'#aabbcc'},avatarStyle:'detailed',avatarSupported:false};
 const api=new WorldsBay({fetch:async()=>json(appearance)});
 assert.deepEqual(await api.readAppearance(),appearance);
 const server=new WorldClient({centralUrl:'https://central.example',worldId:'test-world',worldSecret:'x'.repeat(32),fetch:async()=>json(appearance)});
 assert.deepEqual(await server.getAppearance('grant'),appearance);
 const worlds=[{id:'own',avatarSupport:[]},{id:'both',avatarSupport:['low-poly','detailed']},{id:'legacy'}];
 assert.deepEqual(await new CentralClient({fetch:async()=>json({worlds})}).getWorlds(),worlds);
});
