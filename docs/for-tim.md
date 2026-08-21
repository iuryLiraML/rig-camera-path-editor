# Rig — notes for Tim

Hi Tim,

I wanted to send you a clear picture of Rig before we talk. This is not a spec, and it is not a request to start building anything yet. I would just like you to understand what the product is, what already works, where it is still rough, and three problems I would really value your help thinking through.

If you read this and the structure feels wrong, I would rather hear that than a plan that follows my current assumptions.

The public editor is here: [github.com/iuryliraml/rig-camera-path-editor](https://github.com/iuryliraml/rig-camera-path-editor). There is also a private cloud backend, but this repo is the app itself.

---

## What Rig is

Rig is a web editor for camera animation, aimed at people who are not 3D professionals.

The loop we want is simple. You bring a 3D model (or lift a photo into a clay figure), you put a camera around it, you tune the move until it feels right, and you export a clean reference video. That video is meant to go into generative tools afterwards — as a motion and framing guide, not as the final look.

That is why the scene stays clay and grayscale. The product is not trying to be a renderer. Depth, outline, and normals exports exist for the same reason: they are useful as ControlNet-style references, not as pretty pictures.

The person we have in mind is closer to a director or someone on a brand team than a Maya artist. So the editor tries to stay slider-first. You can draw a path by hand if you want, but you should not have to think like an animator to get a decent orbit, a dolly-in, or a packshot.

---

## How someone uses it today

You land on a **projects home**. Each card is a job you have been working on. You open one, and you are in the editor.

The editor has three modes:

**Build** is where you make the world. Import `.glb` files, add simple shapes (box, sphere, and so on), move things around, duplicate, rename. Objects sit on the floor in a clay look. You can also attach a photo in the Director chat and lift people or a prop into the scene.

**Compose** is where you make the camera. You draw a path with a pen tool, or you start from a preset (orbit, half arc, flyover, push-in). You can raise the path, round the corners, move individual points in 3D, and decide whether the camera looks at a target or looks where it is flying. There is a timeline for timing, a small live camera preview, and a sequence strip where you save takes.

**Visualize** is labeled as “generate a reference from a prompt.” In practice it is still thin: the editing tools hide, and the Director chat stays. It is more of a quieter canvas than a finished generate workspace.

On the right, in Build and Compose, there is **Director**: a chat that tries to build the shot for you from a description. I will come back to that, because it is one of the things I want your help with.

When the move is good, you export. The main output is an MP4 of the camera animation, rendered frame by frame so it stays smooth. You can also export a still at the current frame, and you can export matching clay / depth / outline / normals versions of the same move.

Saving is automatic. Close the tab, come back, the project is still there — in that browser.

---

## How it is put together (only what matters)

The editor runs in the browser. You do not need a server to place objects, animate a camera, or export a video. That is intentional: the core product should keep working as a local tool.

A **project** is the unit of work. Inside it lives:

- one 3D stage (the objects)
- the current camera (path, lens, timing)
- a list of saved takes
- notes for the Director (guidelines, custom camera recipes, the chat)

That whole project is stored locally on the machine. If Google login is connected to the private backend, the same project can also sync to the cloud, so it is not trapped on one computer. Without that backend, login simply is not available, and everything stays in the browser you are using.

The architecture I would like you to keep in mind is mostly this:

```
Projects home  →  one project  →  one 3D stage
                                   + camera takes saved against that stage
                                   + Director helping author those takes
```

There is no real “scene” object yet, even though the home screen sometimes says “scenes.” More on that below.

Two constraints are worth knowing if we start changing things:

1. The animation has to be determined only by time on the timeline. Preview, scrubbing, and the exported MP4 have to match. If a camera trick only looks right while it is playing forward, it will look wrong in the file we send to a video model.
2. The clay grayscale look is a product choice, not a missing feature. I would rather we not drift into colored lights and materials unless we decide the aesthetic has changed.

---

## What already works

This part is in good shape. Someone can sit down and make a real piece.

**The stage.** Multiple models, simple primitives, transform gizmos, an outliner, undo. Photo-to-clay people and props, when a fal.ai key is set. The scene survives a reload.

**The camera.** Drawing paths, presets, Bézier handles, look-at, FOV, roll, a free camera you can fly with WASD, handheld-style noise (a dedicated shake control, not jittering the path by hand). Objects can also follow a path, so a car can drive a route while the camera covers it.

**Time.** A timeline with keys for camera progress (“at 2 seconds, be 80% along the path”) and for object pose. Duration, easing, loop. You can split the viewport (editor / camera / front / top / right), and you can play fullscreen through the cinema camera.

**Takes.** In Compose you can save the current camera as a shot, reorder the cards, and play them as a short animatic. Loading a shot puts that camera back. It does not swap the 3D world.

**Export.** MP4, PNG, and the technical passes, at 16:9 / 1:1 / 9:16 and a few resolutions, including custom.

**Director, when it behaves.** You can say something like “slow orbit around the bottle, then hold,” and it will try to build that: pick a subject, place a path, set duration and lens, then play it. It has cinematography recipes for packshot, drone, dolly, orbit-reveal, handheld, and a few others. You can also write your own recipe on the project.

---

## What is unfinished, or more confusing than it looks

I would rather be honest here than have you discover this after a few days.

**Visualize** is a mode in the switcher, but it is not a generate product yet.

We once had a longer **setup wizard**: upload a brief, interview the client, write guidelines, propose a shot list, then enter the editor. The screens still exist in the codebase. The app no longer opens them. New projects go straight to the editor. I am not sure whether that instinct was right and we should bring a lighter version back, or whether it was the wrong shape and we should let it go.

There was also a full **storyboard page**. What shipped is the sequence strip inside Compose. Same idea, smaller surface.

**Login** is real in the code — Google, then projects listed from the cloud — but only if the private backend is configured. Day to day, most people are just “whoever is using this browser.” There are no user profiles in the local app. Signing out clears local data so the next person does not inherit your files. That is isolation by deletion, not by accounts.

The home screen calls saved takes **“scenes.”** They are not. They are camera snapshots of the same stage. If you need a kitchen and then a seamless studio, the honest workaround today is two projects.

Director is promising and still brittle. It often guesses the kind of shot from a few words, then loads a recipe. The nicest recipes want a custom path with a beginning, a middle, and a hold. The agent is also steered toward simple preset moves (orbit, dolly, flyover). Those two ideas fight. Some recipes exist but are almost never chosen. There is supposed to be a way to force a skill from the UI; that was never finished.

A few other leftovers, so they do not look like product: we used to mention extra AI providers that are gone; folders on the home screen are local only and will not follow you to another machine; deleting a project in the cloud is not wired from the client.

Collaboration (two people in the same file) and mobile are out of scope for now, unless you make a strong case otherwise.

---

## Where I would love your help

These are the three things. The rest of the document is only so you are not designing in the dark.

### 1. People, login, and keeping work separate

Right now the app does not really have users. It has a browser.

If you and I open the same machine, we see the same projects. If cloud login is on, the server knows who we are, and each account gets its own list — but locally it is still one pile, and sign-out wipes that pile. API keys for the Director are either typed into Settings on that computer, or stored in the cloud vault once you are signed in.

I do not need “add a login button.” The button exists. I need a model that a person can understand:

- What does it mean to have an account in Rig?
- How do we make sure my projects never appear in yours — including the 3D files and the shot thumbnails?
- What happens if someone works without an account, or the internet is down? Local-first is a feature. I do not want the public editor to require a server just to move a camera.
- Shared computers (an agency iMac, a family laptop): can I switch person without destroying the previous person’s local files, unless that is actually what we want?
- Is Google enough, or do we need something for people who will never connect a cloud account?

I am not attached to the current shape. If “profile” should sit above “project” in a way we do not have yet, that is useful to hear.

### 2. Projects, scenes, and shots

This is the structure of the product, and I think we named it before we designed it.

In my head, as someone using this like a small film:

- A **project** is the job (the client, the film, the campaign).
- A **scene** is a place (the kitchen, the pack on a seamless, the street).
- A **shot** is a take in that place (hero orbit, close-up of the label, drone arrive). A shot has a camera, a duration, a thumbnail, and later maybe the generated video we sent out.

What we actually built is flatter: one project, one 3D stage, many camera takes of that stage. That was enough to ship. It starts to hurt as soon as a job has two locations, or a still life and a walk-through, and you do not want to duplicate the whole project.

There are also extra lists that overlap: saved shots, named camera alternatives inside the editor, and an old “planned shot list” from the wizard we retired. Three ways to say “a take” is too many.

I would like you to help find a structure people can think in — not just a nested tree in the sidebar. Some of the questions:

- Should a scene become a real place, with its own objects, and shots hanging off it?
- Or do we keep one stage and treat shots as cameras plus what is visible / how things are arranged?
- Is the sequence strip the spine of the product (the thing you live in), or just a filmstrip at the bottom?
- If we ever want “generate a set of cameras for this pack,” where does that live — in the sequence, in Director, in Visualize?

### 3. The Director, and the camera skills

Director is the part I am most excited about, and the part that still feels like a prototype of the right idea.

The idea: you talk the way a director talks (“give me a slow beauty orbit, then hold on the label”), and the app builds a camera that a person could also have made by hand. Under the hood it has recipes — packshot, drone, dolly, and so on — plus any custom ones on the project. After it builds a move, a simple checker looks at whether the subject actually fills the frame the way the request implied.

Where it falls down is less “we need more recipes” and more “the system does not have a clean idea of what a good camera skill is.”

Sometimes it misreads the request and loads the wrong recipe. Sometimes the recipe wants a three-act path, and the agent is only allowed to drop in a preset orbit. Visualize sounds like the home of this, but it does not have a generate UI. The old wizard wanted to produce a shot list *before* you entered the editor; that pipeline is disconnected now, so we have two stories about how direction enters the app.

I would like your help on the model, not on adding a few more markdown files:

- What should a camera skill *be*? A recipe the model reads? A small set of moves we know are good, with the model only filling in parameters? Something that actually authors a path the way a cinematographer would?
- How does Director relate to Visualize, and to the sequence of shots?
- Do we still want a conversation up front that produces a shot list, or should direction only happen inside the editor, on the stage you already have?
- How do we make this trustworthy enough that someone would use it on real work, not just as a demo?

One thing to protect: whatever the agent does still has to turn into data on the timeline (a path, keys, a hold, a bit of shake). If it only “looks right while playing,” the export will not match.

---

## What I would like back

If you can, spend a little time in the app, then tell me how you would think about those three problems. A short note is enough. A sketch is even better. I am not looking for estimates or a task breakdown.

I am completely open to you proposing a different shape than the one I described. If the three problems are actually one, or if something I am treating as leftover is the real product, I want to hear that.

Thank you for taking a look.

Iury
