"""Tiny OpenAI-compatible mock provider for local development and demos (no real AI, no cost).

    uvicorn scripts.mock_provider:app --port 9000

Then add endpoint `http://localhost:9000/v1` in the UI. Because that is a private
http address, run the main backend with SSRF_ALLOW_PRIVATE=true SSRF_ALLOW_HTTP=true
— for LOCAL DEVELOPMENT ONLY, never on a public deployment.

Models:
  mock-fast, mock-slow, mock-vision, mock-image (images endpoint), mock-flaky (fails ~50%),
  mock-long (very long answer), mock-rich (markdown, code, html/csv/json/svg, attachments),
  mock-audio (OpenAI-style streamed PCM audio), mock-gimg (image returned via delta.images),
  mock-game (single-file HTML Snake with localStorage high score), mock-game-split (html + css + js blocks),
  mock-anim (HTML: CSS keyframes + canvas), mock-p5 (JS-only p5 sketch), mock-three (JS-only three.js module),
  mock-broken (three r128 page that throws: CapsuleGeometry does not exist in r128),
  mock-solver (solves arena maze challenges + easy coding problems), mock-loop (infinite-loop code),
  mock-latin1 (UTF-8 emoji sent with a WRONG `charset=iso-8859-1` header, like some gateways),
  mock-flash-image (like gemini-*-image: /images/generations → 404, returns images via chat delta.images).
"""

from __future__ import annotations

import asyncio
import base64
import json
import math
import random
import struct
import time
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(title="mock-openai-compatible")

MODELS = {
    "mock-fast": 0.01,
    "mock-slow": 0.08,
    "mock-vision": 0.02,
    "mock-flaky": 0.02,
    "mock-long": 0.002,
    "mock-rich": 0.003,
    "mock-audio": 0.01,
    "mock-gimg": 0.01,
    "mock-game": 0.002,
    "mock-game-split": 0.002,
    "mock-anim": 0.002,
    "mock-p5": 0.002,
    "mock-three": 0.002,
    "mock-broken": 0.002,
    "mock-latin1": 0.002,
    "mock-flash-image": 0.01,
    "mock-solver": 0.002,
    "mock-loop": 0.002,
}
# 1x1 PNG
PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="


def _tiny_pdf() -> str:
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R "
        "/Resources << /Font << /F1 5 0 R >> >> >>",
        None,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    stream = b"BT /F1 18 Tf 20 60 Td (Mock PDF from the model) Tj ET"
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        if body is None:
            out += f"{i} 0 obj << /Length {len(stream)} >> stream\n".encode() + stream + b"\nendstream endobj\n"
        else:
            out += f"{i} 0 obj {body} endobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode()
    return "data:application/pdf;base64," + base64.b64encode(bytes(out)).decode()


def _tone_pcm16(seconds: float = 0.6, freq: float = 440.0, rate: int = 24_000) -> bytes:
    n = int(seconds * rate)
    return b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * freq * i / rate))) for i in range(n))


SNAKE_CSS = "body{margin:0;background:#0f172a;color:#e2e8f0;font-family:sans-serif;text-align:center}canvas{background:#020617;border:2px solid #38bdf8;margin-top:8px}"
SNAKE_JS = """const c=document.getElementById('c'),x=c.getContext('2d'),S=16,N=20;
let snake=[{x:8,y:10}],dir={x:1,y:0},food={x:14,y:10},score=0;
let best=Number(localStorage.getItem('snake-best')||0);
const plays=Number(localStorage.getItem('snake-plays')||0)+1;localStorage.setItem('snake-plays',plays);
const hud=document.getElementById('hud');
function draw(){hud.textContent='Score '+score+' · Best '+best+' · Plays '+plays+' · arrows/WASD';
x.fillStyle='#020617';x.fillRect(0,0,S*N,S*N);x.fillStyle='#f43f5e';x.fillRect(food.x*S,food.y*S,S-1,S-1);
x.fillStyle='#22c55e';snake.forEach(p=>x.fillRect(p.x*S,p.y*S,S-1,S-1));}
function step(){const h={x:(snake[0].x+dir.x+N)%N,y:(snake[0].y+dir.y+N)%N};
if(snake.some(p=>p.x===h.x&&p.y===h.y)){snake=[{x:8,y:10}];dir={x:1,y:0};score=0;}
snake.unshift(h);if(h.x===food.x&&h.y===food.y){score++;if(score>best){best=score;localStorage.setItem('snake-best',best);}
food={x:Math.floor(Math.random()*N),y:Math.floor(Math.random()*N)};}else snake.pop();draw();}
addEventListener('keydown',e=>{const k={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]}[e.key];
if(k&&(k[0]!==-dir.x||k[1]!==-dir.y)){dir={x:k[0],y:k[1]};e.preventDefault();}});
setInterval(step,120);draw();"""
SNAKE_BODY = '<div id="hud"></div><canvas id="c" width="320" height="320"></canvas>'
GAME_ANSWER = (
    "Here is a playable **Snake** game in one HTML file. Use the arrow keys or WASD; "
    "your best score is saved.\n\n```html snake.html\n<!doctype html><html><head><meta charset='utf-8'>"
    f"<title>Snake</title><style>{SNAKE_CSS}</style></head><body>{SNAKE_BODY}<script>{SNAKE_JS}</script>"
    "</body></html>\n```\n"
)
GAME_SPLIT_ANSWER = (
    "Snake split into three files:\n\n```html index.html\n<!doctype html><html><head><meta charset='utf-8'>"
    f"<link rel='stylesheet' href='style.css'></head><body>{SNAKE_BODY}<script src='game.js'></script></body></html>"
    f"\n```\n\n```css style.css\n{SNAKE_CSS}\n```\n\n```javascript game.js\n{SNAKE_JS}\n```\n"
)

ANIM_ANSWER = (
    "An animation with CSS keyframes and a canvas particle loop:\n\n```html anim.html\n<!doctype html><html><head><style>"
    "body{margin:0;background:#0b1020;color:#fff;font-family:sans-serif;overflow:hidden}"
    ".orb{position:absolute;top:30px;left:30px;width:60px;height:60px;border-radius:50%;"
    "background:radial-gradient(#7dd3fc,#2563eb);animation:float 2s ease-in-out infinite alternate}"
    "@keyframes float{to{transform:translate(260px,40px) scale(1.4)}}</style></head><body><div class=orb></div>"
    "<canvas id=c width=640 height=360></canvas><script>const c=document.getElementById('c'),x=c.getContext('2d');"
    "let t=0;function loop(){t+=0.03;x.fillStyle='rgba(11,16,32,0.25)';x.fillRect(0,0,640,360);"
    "for(let i=0;i<40;i++){const a=t+i*0.16;x.fillStyle='hsl('+(i*9+t*40)%360+',80%,60%)';"
    "x.beginPath();x.arc(320+Math.cos(a*1.3)*(60+i*3),180+Math.sin(a)*(40+i*2),4,0,7);x.fill();}"
    "requestAnimationFrame(loop)}loop();</script></body></html>\n```\n"
)
P5_ANSWER = (
    "A p5.js sketch (JavaScript only):\n\n```javascript sketch.js\nfunction setup() {\n  createCanvas(480, 300);\n  noStroke();\n}\n\n"
    "function draw() {\n  background(15, 23, 42, 40);\n  const t = frameCount * 0.04;\n  for (let i = 0; i < 12; i++) {\n"
    "    fill((i * 30 + frameCount) % 360, 80, 200);\n    circle(240 + cos(t + i) * 110, 150 + sin(t * 1.5 + i) * 90, 18);\n  }\n}\n```\n"
)
THREE_ANSWER = (
    "A rotating cube with three.js (ES module, JavaScript only):\n\n```javascript main.js\n"
    "import * as THREE from 'three';\n\nconst scene = new THREE.Scene();\n"
    "const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);\ncamera.position.z = 3;\n"
    "const renderer = new THREE.WebGLRenderer({ antialias: true });\nrenderer.setSize(innerWidth, innerHeight);\n"
    "document.body.appendChild(renderer.domElement);\n"
    "const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial());\nscene.add(cube);\n"
    "function animate() {\n  cube.rotation.x += 0.01;\n  cube.rotation.y += 0.015;\n  renderer.render(scene, camera);\n"
    "  requestAnimationFrame(animate);\n}\nanimate();\n```\n"
)

BROKEN_ANSWER = (
    "Save as index.html:\n\n```html\n<!DOCTYPE html><html><head><style>body{margin:0;background:#87CEEB}</style>"
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head><body><script>\n'
    "const scene=new THREE.Scene();scene.background=new THREE.Color(0x87ceeb);\n"
    "const camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,0.1,100);camera.position.set(0,2,6);\n"
    "const renderer=new THREE.WebGLRenderer();renderer.setSize(innerWidth,innerHeight);document.body.appendChild(renderer.domElement);\n"
    "renderer.render(scene,camera);\n"
    "const rider=new THREE.Mesh(new THREE.CapsuleGeometry(0.3,1,4,8),new THREE.MeshNormalMaterial());\n"
    "scene.add(rider);function loop(){rider.rotation.y+=0.02;renderer.render(scene,camera);requestAnimationFrame(loop)}loop();\n"
    "</script></body></html>\n```\n"
)

RICH_ANSWER = (
    "# Rich output demo\n\nThis answer has **bold**, *italic*, a [link](https://example.com) and a list:\n\n"
    "1. Python code\n2. A live HTML page\n3. CSV, JSON and SVG\n\n"
    "| Model | Score |\n|---|---|\n| A | 0.9 |\n| B | 0.7 |\n\n"
    '```python main.py\ndef greet(name: str) -> str:\n    return f"Hello, {name}!"\n\nprint(greet("arena"))\n```\n\n'
    '```html\n<!doctype html><html><body style="font-family:sans-serif"><h2>Counter</h2>'
    "<button id=b>clicked 0</button><script>let n=0;b.onclick=()=>b.textContent='clicked '+(++n);"
    "try{parent.document.title='pwned'}catch(e){document.body.append(' (sandboxed: '+e.name+')')}</script>"
    "</body></html>\n```\n\n"
    '```csv\nname,city,score\n"Doe, J",Jakarta,90\nAni,Bandung,85\n```\n\n'
    '```json\n{"ok":true,"items":[1,2,3]}\n```\n\n'
    "```svg\n<svg xmlns='http://www.w3.org/2000/svg' width='120' height='60'><rect width='120' height='60' "
    "rx='8' fill='#0ea5e9'/><text x='16' y='38' fill='white' font-size='20'>SVG</text></svg>\n```\n\n"
    "Attachments: report {pdf} and slides https://example.com/files/deck.pptx and a clip "
    "https://example.com/media/clip.mp4\n"
)


@app.get("/v1/models")
async def models() -> dict[str, Any]:
    data = [{"id": m, "object": "model", "owned_by": "mock"} for m in [*MODELS, "mock-image"]]
    return {"object": "list", "data": data}


SOLUTIONS = {
    "Roman numeral": "function solve(n){const t=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],"
    "[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];let o='';for(const[v,s]of t)while(n>=v){o+=s;n-=v}return o}",
    "bracket": "function solve(s){const st=[],p={')':'(',']':'[','}':'{'};for(const c of s){if('([{'.includes(c))st.push(c);"
    "else if(c in p&&st.pop()!==p[c])return false}return st.length===0}",
    # deliberately wrong on the empty string, to exercise partial scores
    "Run-length": "function solve(s){return s.match(/(.)\\1*/g).map(r=>r[0]+r.length).join('')}",
}


def _solve_challenge(text: str) -> str:
    """mock-solver: BFS for maze prompts, canned JS for easy coding problems."""
    if "S is the start and G is the goal" in text:
        grid = text.split("```")[1].strip().splitlines()
        start = next((r, row.index("S")) for r, row in enumerate(grid) if "S" in row)
        prev: dict[tuple[int, int], tuple[tuple[int, int], str] | None] = {start: None}
        queue = [start]
        for r, c in queue:
            if grid[r][c] == "G":
                moves = ""
                node = (r, c)
                while prev[node]:
                    node, m = prev[node]  # type: ignore[misc]
                    moves = m + moves
                return f"Shortest path found by search.\n<answer>{moves}</answer>"
            for m, dr, dc in (("U", -1, 0), ("D", 1, 0), ("L", 0, -1), ("R", 0, 1)):
                n = (r + dr, c + dc)
                if 0 <= n[0] < len(grid) and 0 <= n[1] < len(grid[0]) and grid[n[0]][n[1]] != "#" and n not in prev:
                    prev[n] = ((r, c), m)
                    queue.append(n)
    if "Rubik" in text:  # can't really solve it — just enough moves to watch the 3D replay
        return "Trying a sequence.\n<answer>R U R' U' F2 L D' B2</answer>"
    for key, code in SOLUTIONS.items():
        if key in text:
            return f"Here you go.\n<answer>\n```js\n{code}\n```\n</answer>"
    return "I am not sure. <answer>?</answer>"


def _answer(body: dict[str, Any]) -> str:
    last = body["messages"][-1]["content"]
    text = last if isinstance(last, str) else " ".join(p.get("text", "") for p in last if isinstance(p, dict))
    images = 0 if isinstance(last, str) else sum(1 for p in last if p.get("type") == "image_url")
    extra = f" I also received {images} image(s)." if images else ""
    if body["model"] == "mock-latin1":
        return "Kecepatan: 🐢 Pelan · ⚡ Cepat · 🚲 Normal — naïve café\n\n```html\n<!doctype html><body style='font:20px sans-serif'><button>🐢 Pelan</button> <button>⚡ Cepat</button> <button>🚲 Normal</button></body>\n```\n"
    if body["model"] == "mock-broken":
        return BROKEN_ANSWER
    if body["model"] == "mock-solver":
        return _solve_challenge(text)
    if body["model"] == "mock-loop":
        return "<answer>\n```js\nfunction solve(){ while(true){} }\n```\n</answer>"
    if body["model"] == "mock-anim":
        return ANIM_ANSWER
    if body["model"] == "mock-p5":
        return P5_ANSWER
    if body["model"] == "mock-three":
        return THREE_ANSWER
    if body["model"] == "mock-game":
        return GAME_ANSWER
    if body["model"] == "mock-game-split":
        return GAME_SPLIT_ANSWER
    if body["model"] == "mock-rich":
        return RICH_ANSWER.replace("{pdf}", _tiny_pdf())
    if body["model"] == "mock-long":
        sections = [
            f"## Section {i}\n\nThis is a deliberately long answer to exercise the UI. Point {i} explains the idea in "
            "detail, with a list:\n- first item\n- second item\n- third item\n"
            for i in range(1, 41)
        ]
        return f"# Long answer to: {text[:80]}\n\n" + "\n".join(sections)
    return (
        f"This is a mock answer from {body['model']}. You said: “{text[:200]}”.{extra} "
        "Streaming tokens one by one lets the UI measure time-to-first-token and throughput."
    )


@app.post("/v1/chat/completions", response_model=None)
async def chat(request: Request) -> StreamingResponse | JSONResponse:
    body = await request.json()
    model = body.get("model", "")
    if model not in MODELS:
        return JSONResponse({"error": {"message": "model not found"}}, status_code=404)
    if model == "mock-flaky" and random.random() < 0.5:
        return JSONResponse({"error": {"message": "overloaded"}}, status_code=503)
    delay = MODELS[model]
    words = _answer(body).split(" ")
    prompt_tokens = sum(len(str(m.get("content", ""))) for m in body["messages"]) // 4

    if not body.get("stream"):
        await asyncio.sleep(delay * len(words))
        return JSONResponse(
            {
                "choices": [{"message": {"role": "assistant", "content": " ".join(words)}}],
                "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": len(words)},
            }
        )

    async def events() -> AsyncIterator[str]:
        await asyncio.sleep(delay * 10)  # time to first token
        if model in ("mock-gimg", "mock-flash-image"):
            img = {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{PIXEL}"}}
            yield f"data: {json.dumps({'choices': [{'delta': {'images': [img]}}]})}\n\n"
        if model == "mock-audio":
            pcm = _tone_pcm16()
            for i in range(0, len(pcm), 4801):  # odd sizes on purpose: fragments must decode separately
                chunk = base64.b64encode(pcm[i : i + 4801]).decode()
                yield f"data: {json.dumps({'choices': [{'delta': {'audio': {'data': chunk}}}]})}\n\n"
        if model == "mock-solver":  # reasoning models stream their thinking first
            thoughts = "Reading the puzzle. Trying a breadth-first search from the start. Checking each neighbour, avoiding walls. " * 4
            if "Rubik" in json.dumps(body["messages"]):
                thoughts = (
                    "Looking at the U face and the corners URF and UBR. Let me try R U R' U' first. "
                    "Hmm, that breaks the cross on F. Try F2 L D' B2 instead. Checking the D face again... "
                    "What about U R2 F' L' D2 B? The edges on R look closer now. Final check: R U R' U' F2 L D' B2. "
                )
            for i, part in enumerate(thoughts.split(" ")):
                yield f"data: {json.dumps({'choices': [{'delta': {'reasoning_content': part + ' '}}]})}\n\n"
                await asyncio.sleep(0.12 if "Rubik" in thoughts or "URF" in thoughts else 0.04)
        for i, word in enumerate(words):
            text = word + (" " if i < len(words) - 1 else "")
            chunk = {"id": "mock", "created": int(time.time()), "choices": [{"delta": {"content": text}}]}
            yield f"data: {json.dumps(chunk)}\n\n"
            await asyncio.sleep(delay)
        usage = {"choices": [], "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": len(words)}}
        yield f"data: {json.dumps(usage)}\n\n"
        yield "data: [DONE]\n\n"

    headers = {"content-type": "text/event-stream; charset=iso-8859-1"} if model == "mock-latin1" else None
    return StreamingResponse(events(), media_type="text/event-stream", headers=headers)


@app.post("/v1/images/generations", response_model=None)
async def images(request: Request) -> dict[str, Any] | JSONResponse:
    body = await request.json()
    if body.get("model") == "mock-flash-image":
        return JSONResponse({"error": {"message": "use chat completions"}}, status_code=404)
    await asyncio.sleep(0.5)
    return {"created": int(time.time()), "data": [{"b64_json": PIXEL} for _ in range(int(body.get("n", 1)))]}
