// Angular in JIT mode (no Angular CLI, no decorators): enough to show the custom elements in an Angular template.
import 'zone.js';
import '@angular/compiler';
import { Component, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { definePagewrightElements } from '@pagewrightjs/angular';
import definition from '../../report.pw.json';
import orders from '../../data.json';

definePagewrightElements();
class App { options = { definition, data: { orders }, fontsUrl: '/pw/fonts/', height: '760px' }; }
Component({
  selector: 'app-root',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: '<pagewright-viewer [options]="options" (pw-error)="error($event.detail)"></pagewright-viewer>',
})(App);
App.prototype.error = (e) => console.error(e);
bootstrapApplication(App);
