# RoomFortyRecorder

![GitHub all releases](https://img.shields.io/github/downloads/silverbrit/RoomFortyRecorder/total)
![Version](https://img.shields.io/github/package-json/v/silverbrit/RoomFortyRecorder?filename=release%2Fapp%2Fpackage.json)
![Discord](https://img.shields.io/discord/1004860808737591326)

RoomFortyRecorder is a modified Warcraft Recorder client for retail PvE (raids and Mythic+) and a desktop screen recorder. It watches the WoW combat log file for interesting events, records them, and presents a user interface in which the recordings can be viewed.

<img width="1920" height="1032" alt="image" src="https://github.com/user-attachments/assets/aea579e3-5a7f-477d-bea0-273556a3ef9b" />

# How to Use

1. Download and run the most recent [RoomFortyRecorder installer](https://github.com/silverbrit/RoomFortyRecorder/releases/latest).
2. Launch the application and click the Settings button.
   - Create a folder on your PC to store the recordings.
   - Set the Storage Path to the folder you just created.
   - Enable recording and set the location of your World of Warcraft logs folder.
   - Modify any other settings as desired.
3. Click the Scene button and configure the OBS scene and recording settings.
   - Select your desired output resolution.
   - Add your speakers and/or microphone if you want to include audio.
   - Recommend selecting a hardware encoder, if available.
   - Modify any other settings as desired.
4. Install the required combat logging addon, enabling advanced combat logging when prompted.
   - Retail and Retail PTR: SimpleCombatLogger ([CurseForge](https://www.curseforge.com/wow/addons/simplecombatlogger), [Wago](https://addons.wago.io/addons/simplecombatlogger)).

While viewing a recording, toggle drawing mode to use the Excalidraw tools or select a raid marker, class icon, or Warlock Gate preset from the top-right preset menu, then click the video to place it. Placed annotations can be dragged and are temporary; they clear with the drawing overlay.

# Supported Platforms

| OS      | Support |
| ------- | ------- |
| Windows | Yes     |
| Mac     | No      |
| Linux   | No      |

| Flavour          | Support     |
| ---------------- | ----------- |
| Retail PvE       | Yes         |
| Retail PTR PvE   | Best Effort |

# Testing It Works

You can test that Warcraft Recorder works by clicking the test icon with World of Warcraft running after you have completed the above setup steps. This runs a short test of the recording function.

# Private guild cloud server

The guild cloud setup can store recordings on a guild-owned Windows host and SSD instead of paying $30/month for the WCR Platinum plan. See [the guild cloud guide](docs/GuildCloudServer.md) for the server setup and client build.

# Bug Reports & Suggestions

Please create an issue, I will get to it eventually. Bear in mind maintaining this is a hobby for me, so it may take me some time to comment. If you think you can improve something, feel free to submit a PR.

I've created a dedicated discord for this project, feel free to join [here](https://discord.gg/NPha7KdjVk).

# Contributing

If you're interested in getting involved please drop me a message on discord and I can give you access to our development channel. Also see [contributing](https://github.com/silverbrit/RoomFortyRecorder/blob/main/docs/CONTRIBUTING.md) docs.

# Mentions

The recording done by Warcraft Recorder is made possible by packaging up [OBS](https://obsproject.com/). We wouldn't stand a chance at providing something useful without it. Big thanks to the OBS developers.

The app is built with [Electron](https://www.electronjs.org/) and [React](https://react.dev/), using the boilerplate provided by the [ERB](https://electron-react-boilerplate.js.org/) project.

Drawing overlay created using [Excalidraw](https://github.com/excalidraw/excalidraw).
