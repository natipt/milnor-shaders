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
  fragmentShader: `
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
    float fiberFunction(vec3 p) {
        vec4 s = stereographicInverse(p);
        vec2 x = s.xy;
        vec2 y = s.zw;
        float norm = dot(x, x) + dot(y, y);
        if (abs(norm - 1.0) > 0.1) return 1.0;
        vec2 fxy = complexAdd(complexMul(x, x), complexPow3(y));
        float mag = length(fxy);
        if (mag < 1e-10) return 1.0; // avoid division by zero near the knot
        vec2 fhat = fxy / mag; // normalize f to unit circle
        float diff = mod(arg(fhat) - theta + 3.14159, 6.28318) - 3.14159;
        // float diff = mod(arg(fhat) - theta, 6.28318);
        // return diff; // small only near the fiber
        return sin(arg(fhat) - theta);
      }
      
      

      float knotFunction(vec3 p) {
        vec4 s = stereographicInverse(p);
        vec2 x = s.xy;
        vec2 y = s.zw;
        float norm = dot(x, x) + dot(y, y);
        if (abs(norm - 1.0) > 0.1) return 1.0;
        vec2 fxy = complexAdd(complexMul(x, x), complexPow3(y));
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
      for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ro + t * rd;
        // if (t < 1.5) {
        //     t += 0.05;
        //     continue;
        //   }
        float d = fiberFunction(p);
        float k = knotFunction(p);
        // if (k < KNOT_THRESHOLD) return vec3(1.0, 0.0, 0.0); // red for trefoil knot

        // bigger knot radius near origin
        // float knotRadius = 0.04 + 0.3 * exp(-dot(p, p));
        float knotRadius = clamp(0.05 + 0.03 / (1.0 + 5.0 * dot(p, p)), 0.04, 0.08);
        // float knotRadius = KNOT_THRESHOLD + 0.5 / (1.0 + 7.0 * dot(p, p));

        if (k < knotRadius) {
            // vec3 kn = getKnotNormal(p);
            // vec3 lightDir = normalize(vec3(1.0, 1.0, 2.0));
            // vec3 viewDir = normalize(-rd);
            // vec3 halfVec = normalize(lightDir + viewDir);
            // float diff = max(dot(kn, lightDir), 0.0);
            // float spec = pow(max(dot(kn, halfVec), 0.0), 64.0);
            // // vec3 base = vec3(0.05, 0.05, 0.08);
            // vec3 base = vec3(0.5);
            // vec3 ambient = 0.1 * base;
            // vec3 color = ambient + base * diff + vec3(1.0) * spec;
            vec3 kn = getKnotNormal(p);
            float shade = 0.5 + 0.5 * dot(kn, -rd);
            return vec3(1.0); // matte white with diffuse lighting only
            // return color;
          }
        // if (d < 0.0) return vec3(1.0, 0.0, 0.0); // highlight negative region in red

        if (d < SURFACE_THRESHOLD) {
            vec3 normal = getNormal(p);
            // if (dot(normal, -rd) <= 0.0) {
            //     t += 0.01;
            //     continue;
            //   }
            vec3 lightDir = normalize(vec3(1.0, 1.0, 2.0));
            vec3 viewDir = normalize(-rd);
            vec3 halfVec = normalize(lightDir + viewDir);
          
            // float diff = max(dot(normal, lightDir), 0.0);
            float spec = pow(max(dot(normal, halfVec), 0.0), 64.0);
          
            vec3 base = 0.5 + 0.5 * normal;
            // vec3 ambient = 0.1 * base; // ambient color
            // vec3 color = ambient + base * diff + vec3(1.0) * spec;
            vec3 color = base + 0.1 * vec3(1.0) + vec3(1.0) * spec;
          
            return color;
          }
        if (t > MAX_DIST) break;

        // reduce stepsize near origin
        // float stepSize = clamp(min(abs(d), k), 0.01, 0.2);
        float stepSize = clamp(min(abs(d), k), 0.002, 0.05);

        t += stepSize;

        // t += min(d, k) * 0.5;
      }
      return vec3(0.0);
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
});

const geometry = new THREE.PlaneGeometry(2, 2);
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

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

uniforms.cameraMatrix = { value: new THREE.Matrix3() };

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

