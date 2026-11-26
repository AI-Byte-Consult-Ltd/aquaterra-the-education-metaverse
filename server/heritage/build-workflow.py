"""Writes the n8n SDK code of [71 PUBLIC] AquaTerra Heritage from verify.cjs, validate.js, chain.js, owner.js.
python3 server/heritage/build-workflow.py > workflow.js"""
import json, os
H = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(H, f)).read()
v = rd('verify.cjs').replace("if (typeof module !== 'undefined') module.exports = { recoverPersonal, keccak256 };\n", "")
J = json.dumps
print(rd('workflow.tpl.js').replace('__VALIDATE__', J(v + "\n" + rd('validate.js'))).replace('__CHAIN__', J(rd('chain.js'))).replace('__OWNER__', J(rd('owner.js'))))
