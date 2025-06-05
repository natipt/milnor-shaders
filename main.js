// Import three.js from CDN
import * as THREE from 'https://unpkg.com/three@0.155.0/build/three.module.js';

// Create WebGL renderer and bind to canvas
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);

// Basic scene setup
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

// Shader uniforms
const uniforms = {
  epsilon: { value: new THREE.Vector2(0.1, 0.0) }, // complex constant epsilon = 0.1
  theta: { value: Math.PI }, // initial angle for Milnor fiber
  time: { value: 0.0 } // animated time
};

// Parse user poly
function parsePolynomial(expr) {
    expr = expr.replace(/\s+/g, '');
    const terms = expr.match(/[+-]?[^+-]+/g); // separate by +/- terms
  
    if (!terms) return 'vec2(0.0, 0.0)';
  
    let glsl = terms.map(term => {
      if (/^[+-]?\d*\.?\d*$/.test(term)) {
        // real constant
        return `vec2(${parseFloat(term)}, 0.0)`;
      }
  
      const match = term.match(/^([+-]?[\d\.]*)?(x|y)(\^(\d+))?$/);
      if (match) {
        let [, coeff, variable, , power] = match;
        coeff = coeff || '+1';
        if (coeff === '+') coeff = '1';
        if (coeff === '-') coeff = '-1';
        power = parseInt(power || '1');
  
        let base = variable;
        for (let i = 1; i < power; i++) {
          base = `complexMul(${base}, ${variable})`;
        }
        return `complexMul(vec2(${coeff}, 0.0), ${base})`;
      }
  
      if (term.includes('x') && term.includes('y')) {
        return `complexMul(${term.replace(/([xy])/g, 'vec2($1, 0.0)')})`;
      }
  
      return `vec2(0.0) /* unparsed: ${term} */`;
    });
    console.log(glsl.join(' + '));
    return glsl.join(' + ');
  }
  

function buildGLSLFunction(expr) {
    const body = parsePolynomial(expr);
    return `
        vec2 f(vec2 x, vec2 y) {
            return ${body};
        }
        `;
}

let baseShaderTemplate = `
    precision highp float;
    varying vec2 vUv;
    uniform vec2 epsilon;
    uniform float theta;
    uniform float time;
    uniform vec2 resolution;
    uniform mat3 cameraMatrix;


    // Constants for raymarching
    #define MAX_STEPS 200
    // #define SURFACE_THRESHOLD 0.01
    #define SURFACE_THRESHOLD 0.005
    #define KNOT_THRESHOLD 0.1
    #define MAX_DIST 10.0
    #define NEAR_CLIP 0.4

    vec4 stereographicInverse(vec3 p) {
      float denom = 1.0 + dot(p, p);
      float xr = 2.0 * p.x / denom;
      float xi = 2.0 * p.y / denom;
      float yr = 2.0 * p.z / denom;
      float yi = (dot(p, p) - 1.0) / denom;
      return vec4(xr, xi, yr, yi);
    }

    vec2 complexAdd(vec2 a, vec2 b) {
      return a + b;
    }

    vec2 complexMul(vec2 a, vec2 b) {
      return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x);
    }

    vec2 complexPow3(vec2 z) {
      return complexMul(z, complexMul(z, z));
    }

    float arg(vec2 z) {
      return atan(z.y, z.x);
    }
    
    // REPLACE_F_FUNCTION
    
    float fiberFunction(vec3 p) {
        vec4 s = stereographicInverse(p);
        vec2 x = s.xy;
        vec2 y = s.zw;
        float norm = dot(x, x) + dot(y, y);
        if (abs(norm - 1.0) > 0.1) return 1.0;
        vec2 fxy = f(x, y); // Call dynamically defined function
        float mag = length(fxy);
        if (mag < 1e-10) return 1.0; // avoid division by zero near the knot
        vec2 fhat = fxy / mag; // normalize f to unit circle
        float diff = mod(arg(fhat) - theta + 3.14159, 6.28318) - 3.14159;
        // float diff = mod(arg(fhat) - theta, 6.28318);
        return diff; // small only near the fiber
        // return sin(diff);
      }
      
      

      float knotFunction(vec3 p) {
        vec4 s = stereographicInverse(p);
        vec2 x = s.xy;
        vec2 y = s.zw;
        float norm = dot(x, x) + dot(y, y);
        if (abs(norm - 1.0) > 0.1) return 1.0;
        vec2 fxy = f(x,y);
        return length(fxy);
      }

    vec3 getNormal(vec3 p) {
      float h = 0.001;
      float dx = fiberFunction(p + vec3(h,0,0)) - fiberFunction(p - vec3(h,0,0));
      float dy = fiberFunction(p + vec3(0,h,0)) - fiberFunction(p - vec3(0,h,0));
      float dz = fiberFunction(p + vec3(0,0,h)) - fiberFunction(p - vec3(0,0,h));
      return normalize(vec3(dx, dy, dz));
    }

    vec3 getKnotNormal(vec3 p) {
        float h = 0.001;
        float dx = knotFunction(p + vec3(h,0,0)) - knotFunction(p - vec3(h,0,0));
        float dy = knotFunction(p + vec3(0,h,0)) - knotFunction(p - vec3(0,h,0));
        float dz = knotFunction(p + vec3(0,0,h)) - knotFunction(p - vec3(0,0,h));
        return normalize(vec3(dx, dy, dz));
      }
  

      vec3 raymarch(vec3 ro, vec3 rd) {
        float t = 0.0;
        bool hitFront = false;
        vec3 frontColor = vec3(0.0);
        float frontOpacity = 0.0;
      
        for (int i = 0; i < MAX_STEPS; i++) {
          vec3 p = ro + t * rd;
          float d = fiberFunction(p);
          float k = knotFunction(p);
      
          float knotRadius = clamp(0.05 + 0.03 / (1.0 + 5.0 * dot(p, p)), 0.04, 0.08);
      
          if (!hitFront && d < SURFACE_THRESHOLD) {
            vec3 normal = getNormal(p);
            vec3 lightDir = normalize(vec3(1.0, 1.0, 2.0));
            vec3 viewDir = normalize(-rd);
            vec3 halfVec = normalize(lightDir + viewDir);
            float spec = pow(max(dot(normal, halfVec), 0.0), 64.0);
            vec3 base = 0.5 + 0.5 * normal;
            vec3 color = base + 0.1 * vec3(1.0) + vec3(1.0) * spec;
      
            if (t < 0.6) {
              // too close, treat as transparent layer
              frontOpacity = smoothstep(0.3, 0.6, t);
              frontColor = color;
              hitFront = true;
            } else {
              return color; // normal case, return immediately
            }
          }
      
          if (k < knotRadius) {
            vec3 kn = getKnotNormal(p);
            float shade = 0.5 + 0.5 * dot(kn, -rd);
            vec3 base = vec3(1.0);
            vec3 color = base * shade;
            return hitFront ? mix(color * 0.4, frontColor, frontOpacity) : color;
          }
      
          if (t > MAX_DIST) break;
      
          float stepSize = clamp(min(abs(d), k), 0.002, 0.05);
          t += stepSize;
        }
      
        return hitFront ? frontColor * frontOpacity : vec3(0.0);
      }
      

    void main() {
    //   vec2 uv = vUv * 2.0 - 1.0;
    // vec2 uv = (vUv * 2.0 - 1.0) * 0.5;
    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
vec2 uv = (vUv * 2.0 - 1.0) * aspect * 1.5; // multiply by something smaller to make it bigger


    //   vec3 ro = vec3(0.0, 0.0, 3.0);
    //   vec3 rd = normalize(vec3(uv.x, uv.y, -2.0));
    // vec3 rd = normalize(vec3(uv.x, uv.y, -1.0)); // less aggressive dive
    vec3 ro = cameraMatrix * vec3(0.0, 0.0, 3.0);
    vec3 rd = normalize(cameraMatrix * vec3(uv, -1.0));


    vec3 color = raymarch(ro, rd);
      gl_FragColor = vec4(color, 1.0);
    }
  `

const userExpr = document.getElementById('polyInput').value;
const fFunction = buildGLSLFunction(userExpr);

const fullShader = baseShaderTemplate.replace('// REPLACE_F_FUNCTION', fFunction);

// Create a full screen quad using a shader material
const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: `
    varying vec2 vUv; // Pass UV coordinates to fragment shader
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0); // Standard vertex transformation
    }
  `,
  fragmentShader: fullShader
});

material.fragmentShader = fullShader;
material.needsUpdate = true;

const geometry = new THREE.PlaneGeometry(2, 2);
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

uniforms.cameraMatrix = { value: new THREE.Matrix3() };

let yaw = 0.0, pitch = 0.0;
let isDragging = false, lastX = 0, lastY = 0;

canvas.addEventListener('mousedown', e => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('mouseup', () => isDragging = false);
canvas.addEventListener('mousemove', e => {
  if (isDragging) {
    yaw += (e.clientX - lastX) * 0.005;
    pitch += (e.clientY - lastY) * 0.005;
    lastX = e.clientX;
    lastY = e.clientY;
  }
});

document.getElementById('updatePoly').addEventListener('click', () => {
    const userExpr = document.getElementById('polyInput').value;
    const fFunction = buildGLSLFunction(userExpr);
    const fullShader = baseShaderTemplate.replace('// REPLACE_F_FUNCTION', fFunction);
  
    material.fragmentShader = fullShader;
    material.needsUpdate = true;
  });
  

function animate(time) {
  uniforms.time.value = time * 0.001;
  uniforms.theta.value = (time * 0.0003) % (2.0 * Math.PI);
// uniforms.theta.value = 0.0;
  uniforms.resolution = { value: new THREE.Vector2(window.innerWidth, window.innerHeight) };
  const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
const xAxis = new THREE.Vector3(cosY, 0, -sinY);
const yAxis = new THREE.Vector3(sinY * sinP, cosP, cosY * sinP);
const zAxis = new THREE.Vector3(sinY * cosP, -sinP, cosP * cosY);
uniforms.cameraMatrix.value.set(
  xAxis.x, yAxis.x, zAxis.x,
  xAxis.y, yAxis.y, zAxis.y,
  xAxis.z, yAxis.z, zAxis.z
);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
  
animate();

