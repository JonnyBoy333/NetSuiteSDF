import * as vscode from 'vscode';

import * as fs from 'fs';
import * as path from 'path';
import { chdir } from 'process';
import { ChildProcess } from 'child_process';

import * as _ from 'lodash';
import { Observable } from 'rxjs/Observable';
import { Subject } from 'rxjs/Subject';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/toPromise';

import { spawn } from 'spawn-rx';

import { Environment } from './environment';
import { SDFConfig } from './sdf-config';
import { SdfCliJson } from './sdf-cli-json';
import { CLICommand } from './cli-command';
import { CustomObjects, CustomObject } from './custom-object';

export class NetSuiteSDF {
  activeEnvironment: Environment;
  collectedData: string[] = [];
  currentObject: CustomObject;
  doAddProjectParameter = true;
  doReturnData = false;
  doSendPassword = true;
  doShowOutput = true;
  intervalId;
  outputChannel: vscode.OutputChannel;
  password: string;
  rootPath: string;
  savedStatus: string;
  sdfcli: Observable<string>;
  sdfConfig: SDFConfig;
  sdfCliIsInstalled = true; // Prevents error messages while Code is testing SDFCLI is installed.
  statusBar: vscode.StatusBarItem;
  hasSdfCache: boolean;

  constructor(private context: vscode.ExtensionContext) {
    this.checkSdfCliIsInstalled().then(() => {
      if (this.sdfCliIsInstalled) {
        this.initializeStatusBar();
        this.outputChannel = vscode.window.createOutputChannel('SDF');
      }
    });
  }

  private initializeStatusBar() {
    this.statusBar = vscode.window.createStatusBarItem();
    this.statusBar.text = this.statusBarDefault;
    this.statusBar.tooltip = 'Click here to select your NetSuite environment';
    this.statusBar.command = 'extension.selectEnvironment';
    this.statusBar.show();
  }

  get statusBarDefault() {
    if (this.activeEnvironment) {
      return `SDF (${this.activeEnvironment.name})`;
    } else {
      return 'SDF';
    }
  }

  /*********************/
  /** SDF CLI Commands */
  /*********************/

  async addDependencies() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doSendPassword = false;

    await this.getConfig();
    const projectName = this.sdfConfig.projectName || 'PROJECT_NAME_MISSING';
    const defaultXml = `
    <manifest projecttype="ACCOUNTCUSTOMIZATION">
      <projectname>${projectName}</projectname>
      <frameworkversion>1.0</frameworkversion>
    </manifest>
    `;
    fs.writeFile(path.join(this.rootPath, 'manifest.xml'), defaultXml, function (
      err
    ) {
      if (err) throw err;
    });
    await this.runCommand(CLICommand.AddDependencies, '-all');
  }

  deploy() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.runCommand(CLICommand.Deploy);
  }

  importBundle() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    // TODO?
    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.ImportBundle);
  }

  async importFiles() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doAddProjectParameter = false;
    this.doReturnData = true;

    const collectedData = await this.listFiles();
    if (collectedData) {
      const filteredData = collectedData.filter(data => data.indexOf('SuiteScripts') >= 0);
      if (filteredData.length > 0) {
        const selectedFiles = await vscode.window.showQuickPick(filteredData, {
          canPickMany: true,
          ignoreFocusOut: true
        });
        if (selectedFiles && selectedFiles.length > 0) {
          this._importFiles(selectedFiles);
        }
      }
    }
  }

  async _importFiles(files: string[]) {
    const cleanedFiles = _.map(files, file => `"${file}"`);
    const fileString = cleanedFiles.join(' ');
    this.runCommand(CLICommand.ImportFiles, `-paths ${fileString}`);
  }

  async importObjects(context?: any) {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    const collectedData = await this.listObjects();
    if (collectedData) {
      const filteredData = collectedData.filter(data => data.indexOf('cust') >= 0);
      if (filteredData.length > 0) {
        const selectedObjects = await vscode.window.showQuickPick(filteredData, {
          canPickMany: true,
          ignoreFocusOut: true
        });
        if (selectedObjects && selectedObjects.length > 0) {
          this.createPath(this.currentObject.destination);
          this._importObjects(
            this.currentObject.type,
            selectedObjects,
            this.currentObject.destination
          );
        }
      }
    }
  }

  async _importObjects(
    scriptType: string,
    scriptIds: string[],
    destination: string
  ) {
    await this.createPath(destination);
    const scriptIdString = scriptIds.join(' ');
    return this.runCommand(
      CLICommand.ImportObjects,
      `-scriptid ${scriptIdString}`,
      `-type ${scriptType}`,
      `-destinationfolder ${destination}`
    );
  }

  issueToken() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.IssueToken);
  }

  listBundles() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.ListBundles);
  }

  listFiles() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doAddProjectParameter = false;
    return this.runCommand(CLICommand.ListFiles, '-folder "/SuiteScripts"');
  }

  listMissingDependencies() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doSendPassword = false;
    this.runCommand(CLICommand.ListMissingDependencies);
  }

  async listObjects() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doAddProjectParameter = false;
    this.doReturnData = true;

    await this.getConfig();
    if (this.sdfConfig) {
      this.currentObject = await vscode.window.showQuickPick(CustomObjects, {
        ignoreFocusOut: true
      });
      if (this.currentObject) {
        return this.runCommand(
          CLICommand.ListObjects,
          `-type ${this.currentObject.type}`
        );
      }
    }
  }

  preview() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.runCommand(CLICommand.Preview);
  }

  revokeToken() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.doAddProjectParameter = false;
    this.runCommand(CLICommand.RevokeToken);
  }

  async update() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    await this.getConfig();
    const objectsRecordPath = path.join(this.rootPath, 'Objects');
    const pathExists = await this.fileExists(objectsRecordPath);

    if (pathExists) {
      const filePathList = await this.getXMLFileList(
        ['Objects'],
        this.rootPath
      );

      if (filePathList.length > 0) {
        const shortNames = filePathList.map(file =>
          file.path.substr(file.path.indexOf('Objects') + 8)
        );
        const selectionArr = await vscode.window.showQuickPick(shortNames, {
          canPickMany: true
        });

        if (selectionArr && selectionArr.length > 0) {
          const selectedFile = filePathList.filter(file => {
            for (const selection of selectionArr) {
              if (file.path.indexOf(selection) >= 0) {
                return true;
              }
            }
          });
          const selectionStr = selectedFile
            .map(file => file.scriptid.substring(0, file.scriptid.indexOf('.')))
            .join(' ');
          this.runCommand(CLICommand.Update, `-scriptid ${selectionStr}`);
        }
      }
    }
  }

  async updateCustomRecordWithInstances() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    await this.getConfig();
    const customRecordPath = path.join(this.rootPath, '/Objects/Records');
    const pathExists = await this.fileExists(customRecordPath);
    if (pathExists) {
      const rawFileList = await this.ls(customRecordPath);
      const fileList = rawFileList.map((filename: string) =>
        filename.slice(0, -4)
      );

      if (fileList) {
        const objectId = await vscode.window.showQuickPick(fileList, {
          ignoreFocusOut: true
        });
        if (objectId) {
          this.runCommand(
            CLICommand.UpdateCustomRecordsWithInstances,
            `-scriptid ${objectId}`
          );
        }
      }
    } else {
      vscode.window.showErrorMessage(
        'No custom records found in /Objects/Records. Import Objects before updating with custom records.'
      );
    }
  }

  validate() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    this.runCommand(CLICommand.Validate);
  }

  /*********************/
  /** VS Code Helpers **/
  /*********************/

  async checkSdfCliIsInstalled() {
    try {
      // Don't like this. There must be a better way.
      const thread = await spawn('sdfcli').toPromise();
      this.sdfCliIsInstalled = true;
    } catch (e) {
      this.sdfCliIsInstalled = false;
      if (e.code === 'ENOENT') {
        vscode.window.showErrorMessage(
          "'sdfcli' not found in path! Check repo for install directions."
        );
      } else {
        throw e;
      }
    }
  }

  cleanup() {
    // Clean up default instance variables (or other matters) after thread closes.
    if (!this.doReturnData) {
      this.collectedData = [];
      this.currentObject = undefined;
    }
    clearInterval(this.intervalId);
    this.clearStatus();

    this.doAddProjectParameter = true;
    this.doReturnData = false;
    this.doSendPassword = true;
    this.intervalId = undefined;
    this.sdfcli = undefined;
    this.doShowOutput = true;
  }

  clearStatus() {
    if (this.savedStatus) {
      this.statusBar.text = this.savedStatus;
      this.savedStatus = undefined;
    } else {
      this.statusBar.text = this.statusBarDefault;
    }
  }

  async getConfig({ force = false }: { force?: boolean } = {}) {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    if (force || !this.sdfConfig) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders) {
        this.rootPath = workspaceFolders[0].uri.fsPath;

        const sdfTokenPath = path.join(this.rootPath, '.clicache');
        const sdfCacheExists = await this.fileExists(sdfTokenPath);

        if (sdfCacheExists) {
          this.hasSdfCache = true;
        }

        const sdfPath = path.join(this.rootPath, '.sdfcli.json');
        const sdfPathExists = await this.fileExists(sdfPath);
        if (sdfPathExists) {
          const buffer = await this.openFile(
            path.join(this.rootPath, '.sdfcli.json')
          );
          const jsonString = buffer.toString();
          try {
            this.sdfConfig = JSON.parse(jsonString);
            await this.selectEnvironment();
          } catch (e) {
            vscode.window.showErrorMessage(
              `Unable to parse .sdfcli.json file found at project root: ${
              this.rootPath
              }`
            );
          }
        } else {
          fs.writeFileSync(
            path.join(this.rootPath, '.sdfcli.json'),
            SdfCliJson
          );
          vscode.window.showErrorMessage(
            `No .sdfcli.json file found at project root: ${
            this.rootPath
            }. Generated a blank .sdfcli.json template.`
          );
        }
      } else {
        vscode.window.showErrorMessage(
          'No workspace folder found. SDF plugin cannot work without a workspace folder root containing a .sdfcli.json file.'
        );
      }
    } else if (!this.activeEnvironment) {
      await this.selectEnvironment();
    }
  }

  handlePassword(
    line: string,
    command: CLICommand,
    stdinSubject: Subject<string>
  ) {
    if (line.startsWith('Enter password:')) {
      line = line.substring(15);
    }
    if (line.includes('You have entered an invalid email address or password. Please try again.')) {
      this.password = undefined;
      vscode.window.showErrorMessage(
        'Invalid email or password. Be careful! Too many attempts will lock you out!'
      );
    }
    return line;
  }

  async handleStdIn(
    line: string,
    command: CLICommand,
    stdinSubject: Subject<string>
  ) {
    switch (true) {
      case (line.includes('Using user credentials.') && this.doSendPassword):
        if (!this.password) {
          await this.resetPassword();
        }
        stdinSubject.next(`${this.password}\n`);
        break;
      case line.includes(
        'WARNING! You are deploying to a Production account, enter YES to continue'
      ):
        const prompt = "Please type 'Deploy' to deploy to production.";
        const answer = await vscode.window.showInputBox({
          prompt: prompt,
          ignoreFocusOut: true
        });
        if (answer === 'Deploy') {
          stdinSubject.next('YES\n');
        } else {
          this.outputChannel.append('Cancelling deployment.\n');
          stdinSubject.next('NO\n');
        }
        break;
      case line.includes('Type YES to continue'):
      case line.includes('enter YES to continue'):
      case line.includes('Type YES to update the manifest file'):
      case line.includes('Proceed with deploy?'):
        stdinSubject.next('YES\n');
        break;
      default:
        break;
    }
  }

  async handleStdOut(line: string, command: CLICommand) {
    switch (true) {
      case line.includes('does not exist.'):
        vscode.window.showErrorMessage(
          'Custom record does exist for updating. Please Import Object first.'
        );
      default:
        break;
    }
  }

  mapCommandOutput(command: CLICommand, line: string) {
    switch (command) {
      case CLICommand.ListObjects:
        return line.includes(':') ? line.split(':')[1] : line;
      default:
        return line;
    }
  }

  refreshConfig() {
    this.getConfig({ force: true });
  }

  async resetPassword() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    const _resetPassword = async () => {
      const prompt = `Please enter your password for your ${
        this.activeEnvironment.name
        } account.`;
      const password = await vscode.window.showInputBox({
        prompt: prompt,
        password: true,
        ignoreFocusOut: true
      });
      this.password = password;
    };

    if (this.sdfConfig) {
      await _resetPassword();
    } else {
      await this.getConfig({ force: true });
      await _resetPassword();
    }
  }

  async runCommand(command: CLICommand, ...args): Promise<any> {
    await this.getConfig();
    if (
      this.sdfConfig &&
      this.activeEnvironment
      // (this.password || this.hasSdfCache) // No need if using tokens
    ) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (this.doShowOutput) {
        this.outputChannel.show();
      }

      const commandArray: [CLICommand, string, string, string, string] = [
        command,
        `-account ${this.activeEnvironment.account}`,
        `-email ${this.activeEnvironment.email}`,
        `-role ${this.activeEnvironment.role}`,
        `-url ${this.activeEnvironment.url}`
      ];

      if (this.doAddProjectParameter) {
        commandArray.push(`-p "${this.rootPath}"`);
      }
      for (let arg of args) {
        commandArray.push(arg);
      }

      const stdinSubject = new Subject<string>();

      this.sdfcli = spawn('sdfcli', commandArray, {
        cwd: this.rootPath,
        stdin: stdinSubject
      });

      this.showStatus();

      let streamWrapper = Observable.create(observer => {
        let acc = '';

        return this.sdfcli.subscribe(
          value => {
            acc = acc + value;
            let lines = acc.split('\n');

            // Check if the last line is a password entry line - this is only an issue with Object and File imports
            const endingPhrases = ['Enter password:'];
            const endingLine = lines.filter(line => {
              for (let phrase of endingPhrases) {
                return line === phrase;
              }

            });
            for (let line of lines.slice(0, -1).concat(endingLine)) {
              observer.next(line);
            }
            acc = endingLine.length > 0 ? '' : lines[lines.length - 1];
          },
          error => observer.error(error),
          () => observer.complete()
        );
      });

      const collectedData = await streamWrapper
        .map(line => this.handlePassword(line, command, stdinSubject))
        .do(
          line =>
            this.doShowOutput ? this.outputChannel.append(`${line}\n`) : null
        )
        .do(line => this.handleStdIn(line, command, stdinSubject))
        .do(line => this.handleStdOut(line, command))
        .filter(
          line =>
            !(
              !line ||
              line.startsWith('[INFO]') ||
              line.startsWith('SuiteCloud Development Framework CLI') ||
              line.startsWith('Done.') ||
              line.startsWith('Using ')
            )
        )
        .map(line => this.mapCommandOutput(command, line))
        .reduce((acc: string[], curr: string) => acc.concat([curr]), [])
        .toPromise()
        .catch(err => this.cleanup());

      this.cleanup();
      return collectedData;
    }
  }

  async selectEnvironment() {
    if (!this.sdfCliIsInstalled) {
      vscode.window.showErrorMessage(
        "'sdfcli' not found in path. Please restart VS Code if you installed it."
      );
      return;
    }

    const _selectEnvironment = async () => {
      try {
        const environments = this.sdfConfig.environments.reduce(
          (acc, curr: Environment) => {
            acc[curr.name] = curr;
            return acc;
          },
          {}
        );
        const environmentNames = Object.keys(environments);
        if (environmentNames.length === 1) {
          const environmentName = environmentNames[0];
          this.activeEnvironment = environments[environmentName];
          this.statusBar.text = this.statusBarDefault;
          vscode.window.showInformationMessage(
            `Found only one environment. Using ${environmentName}`
          );
        } else {
          const environmentName = await vscode.window.showQuickPick(
            environmentNames,
            { ignoreFocusOut: true }
          );
          if (environmentName) {
            this.activeEnvironment = environments[environmentName];
            if (this.activeEnvironment.account === '00000000') {
              vscode.window.showErrorMessage(
                '.sdfcli.json account number appears to be wrong. Are you still using the blank template?'
              );
              this.sdfConfig = undefined;
              this.activeEnvironment = undefined;
              this.clearStatus();
            } else {
              this.statusBar.text = this.statusBarDefault;
            }
          }
        }
      } catch (e) {
        vscode.window.showErrorMessage(
          'Unable to parse .sdfcli.json environments. Please check repo for .sdfcli.json formatting.'
        );
        this.clearStatus();
      }
    };

    if (this.sdfConfig) {
      await _selectEnvironment();
    } else {
      await this.getConfig({ force: true });
      await _selectEnvironment();
    }
  }

  showStatus() {
    this.savedStatus = this.statusBar.text;
    const mode1 = ' [= ]';
    const mode2 = ' [ =]';
    let currentMode = mode1;
    this.intervalId = setInterval(() => {
      currentMode = currentMode === mode1 ? mode2 : mode1;
      this.statusBar.text = this.savedStatus + currentMode;
    }, 500);
  }

  /**************/
  /*** UTILS ****/
  /**************/

  createPath(targetDir) {
    // Strip leading '/'
    targetDir = targetDir.substring(1);
    const sep = path.sep;
    const initDir = this.rootPath;
    const baseDir = this.rootPath;

    targetDir.split(sep).reduce((parentDir, childDir) => {
      const curDir = path.resolve(baseDir, parentDir, childDir);
      try {
        fs.mkdirSync(curDir);
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }

      return curDir;
    }, initDir);
  }

  fileExists(path: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        fs.exists(path, exists => resolve(exists));
      } catch (e) {
        reject(e);
      }
    });
  }

  openFile(path: string): Promise<any> {
    return new Promise((resolve, reject) => {
      fs.readFile(path, (err, data) => {
        if (err) {
          reject(err);
        }
        resolve(data);
      });
    });
  }

  ls(path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      fs.readdir(path, (err, items) => {
        if (err) {
          reject(err);
        }
        resolve(items);
      });
    });
  }

  async getXMLFileList(
    dirList: string[],
    root: string
  ): Promise<{ path: string; scriptid: string }[]> {
    const fileList: { path: string; scriptid: string }[] = [];
    const traverseFolders = async (folders: string[], root: string) => {
      if (folders.length > 0) {
        for (const folder of folders) {
          const rawFileList = await this.ls(path.join(root, folder));
          const dirList: string[] = [];
          for (const fileName of rawFileList) {
            const lstat = fs.lstatSync(path.join(root, folder, fileName));
            if (lstat.isDirectory()) {
              dirList.push(fileName);
            } else {
              if (fileName.slice(fileName.length - 4) === '.xml') {
                fileList.push({
                  path: path.join(root, folder, fileName),
                  scriptid: fileName
                });
              }
            }
          }
          await traverseFolders(dirList, path.join(root, folder));
        }
      } else {
        return folders;
      }
    };
    try {
      await traverseFolders(dirList, root);
      return fileList;
    } catch (err) {
      vscode.window.showErrorMessage('Unable to get file list: ', err.message);
    }
  }
}
