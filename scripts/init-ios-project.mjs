import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const tauri = resolve("node_modules/.bin/tauri");
execFileSync(tauri, ["ios", "init", "--ci", ...process.argv.slice(2)], { stdio: "inherit" });

const storyboardPath = resolve("src-tauri/gen/apple/LaunchScreen.storyboard");
let storyboard = readFileSync(storyboardPath, "utf8");
const systemCapability = '        <capability name="System colors in document resources" minToolsVersion="11.0"/>\n';
const systemBackground = '                        <color key="backgroundColor" systemColor="systemBackgroundColor"/>';
const darkBackground = '                        <color key="backgroundColor" red="0.031372549019607843" green="0.035294117647058823" blue="0.039215686274509803" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>';
const systemResources = `    <resources>
        <systemColor name="systemBackgroundColor">
            <color white="1" alpha="1" colorSpace="custom" customColorSpace="genericGamma22GrayColorSpace"/>
        </systemColor>
    </resources>
`;

if (!storyboard.includes(darkBackground)) {
  assert.ok(storyboard.includes(systemCapability), "generated launch screen system-color capability changed");
  assert.ok(storyboard.includes(systemBackground), "generated launch screen background changed");
  assert.ok(storyboard.includes(systemResources), "generated launch screen resources changed");
  storyboard = storyboard
    .replace(systemCapability, "")
    .replace(systemBackground, darkBackground)
    .replace(systemResources, "");
  writeFileSync(storyboardPath, storyboard);
}

assert.ok(storyboard.includes(darkBackground), "Outflow launch color was not applied");
assert.ok(!storyboard.includes("systemBackgroundColor"), "system launch color remains in the generated project");

const projectPath = resolve("src-tauri/gen/apple/project.yml");
const bindingsPath = resolve("src-tauri/gen/apple/Sources/outflow/bindings/bindings.h");
const xcodeProjectPath = resolve("src-tauri/gen/apple/outflow.xcodeproj/project.pbxproj");
const project = readFileSync(projectPath, "utf8").replace("VALID_ARCHS: arm64 \n", "VALID_ARCHS: arm64\n");
const bindings = `${readFileSync(bindingsPath, "utf8").trimEnd()}\n`;
const generatedXcodeProject = readFileSync(xcodeProjectPath, "utf8");
const temporaryGroupIds = generatedXcodeProject.match(/"TEMP_[A-F0-9-]+"/g) || [];
assert.equal(temporaryGroupIds.length, 1, "generated x86_64 group identifier changed");
const xcodeProject = generatedXcodeProject.replace(temporaryGroupIds[0], '"TEMP_OUTFLOW_X86_64"');
writeFileSync(projectPath, project);
writeFileSync(bindingsPath, bindings);
writeFileSync(xcodeProjectPath, xcodeProject);
assert.ok(project.includes("VALID_ARCHS: arm64\n"), "generated iOS architecture setting was not normalized");
assert.ok(bindings.endsWith("}\n") && !bindings.endsWith("}\n\n"), "generated mobile binding header was not normalized");
assert.ok(xcodeProject.includes('"TEMP_OUTFLOW_X86_64"'), "generated Xcode project identifier was not normalized");
console.log("Generated Outflow iOS project with the dark native launch screen");
