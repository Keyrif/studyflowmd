const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = vm.createContext({TextEncoder,Blob,document:{addEventListener(){}},$:()=>({addEventListener(){}})});
vm.runInContext(fs.readFileSync('assets/skill-export.js','utf8'),context);
test('export preserves duplicate and Unicode notes with safe distinct paths and selected instructions',()=>{
  const refs = context.skillReferences([{title:'../Same',body:'α <script>literal</script>',format:'txt'},{title:'../Same',body:'second',format:'md'}]);
  assert.equal(refs[0].path,'references/001-same.txt');
  assert.equal(refs[1].path,'references/002-same.md');
  assert.equal(refs[0].body,'α <script>literal</script>');
  const md=context.buildSkillMarkdown('test','A "quoted" description\nwith lines',['formula'],'Use course notation.',refs);
  assert.match(md,/State the general formula/);
  assert.doesNotMatch(md,/Explain the solution step by step/);
  assert.match(md,/Use course notation/);
  assert.match(md,/references\/002-same.md/);
  assert.match(md,/description: "A \\"quoted\\" description\\nwith lines"/);
});
test('ZIP directory and local entries preserve UTF-8 contents and valid checksums',async()=>{
  const files=[{path:'skill/SKILL.md',body:'Instructions'},{path:'skill/references/001-note.txt',body:'Știință 📝\nText'}];
  const data=Buffer.from(await context.skillZip(files).arrayBuffer());
  let offset=0;
  for(const file of files){
    assert.equal(data.readUInt32LE(offset),0x04034b50);
    const size=data.readUInt32LE(offset+18),nameLength=data.readUInt16LE(offset+26);
    assert.equal(data.subarray(offset+30,offset+30+nameLength).toString(),file.path);
    const body=data.subarray(offset+30+nameLength,offset+30+nameLength+size);
    assert.equal(body.toString(),file.body);
    let crc=0xffffffff;
    for(const byte of body){crc^=byte;for(let b=0;b<8;b++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    assert.equal(data.readUInt32LE(offset+14),(crc^0xffffffff)>>>0);
    offset+=30+nameLength+size;
  }
  assert.equal(data.readUInt32LE(offset),0x02014b50);
  assert.equal(data.readUInt32LE(data.length-22),0x06054b50);
  assert.equal(data.readUInt16LE(data.length-12),2);
  assert.equal(data.readUInt32LE(data.length-6),offset);
});
