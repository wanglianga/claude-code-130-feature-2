import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { AuthGuard, Roles } from '../auth/auth.guard';
import { UserRole } from '../entities/core';
import { WorkflowService } from './workflow.service';

/** 角色约定：
 * owner 宠物主人；customer_service 客服；driver 接送员；ceremonialist 礼仪师；
 * cremator 火化师；artisan 纪念品制作；finance 财务；manager 管理者
 */
@Controller('api')
@UseGuards(AuthGuard)
export class WorkflowController {
  constructor(private wf: WorkflowService) {}

  // —— 公共目录 ——
  @Get('stores')
  stores() { return this.wf.storesList(); }

  @Get('hospitals')
  hospitals(@Query('store_id') sid: string) { return this.wf.listHospitals(sid ? Number(sid) : undefined); }

  @Get('staff')
  @Roles('customer_service', 'manager')
  staff(@Query('role') role: string, @Query('store_id') sid: string) {
    return this.wf.listStaff(role, sid ? Number(sid) : undefined);
  }

  @Get('resources')
  @Roles('customer_service', 'manager')
  resources(@Query('store_id') sid: string, @Req() req: any) {
    return this.wf.resources(sid ? Number(sid) : (req.user.role === 'manager' ? undefined : req.user.store_id));
  }

  // —— 预约 ——
  @Post('appointments')
  @Roles('owner')
  submit(@Body() body: any, @Req() req: any) { return this.wf.submit(body, req.user); }

  @Get('appointments')
  list(@Req() req: any, @Query() q: any) { return this.wf.list(req.user, q); }

  @Get('appointments/:id')
  detail(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.wf.detail(id, req.user);
  }

  @Post('appointments/:id/quote-preview')
  @Roles('customer_service', 'manager')
  quotePreview(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.quotePreview(id, body, req.user);
  }

  // —— 客服 ——
  @Post('appointments/:id/confirm-plan')
  @Roles('customer_service', 'manager')
  confirmPlan(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.confirmPlan(id, body, req.user);
  }

  @Post('appointments/:id/dispatch')
  @Roles('customer_service', 'manager')
  dispatch(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.dispatch(id, body, req.user);
  }

  @Post('appointments/:id/fee-change')
  @Roles('customer_service', 'manager', 'finance')
  feeChange(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.addFeeChange(id, body, req.user);
  }

  @Post('appointments/:id/reschedule')
  reschedule(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.requestReschedule(id, body, req.user);
  }

  @Post('appointments/:id/reschedule/:cid/approve')
  @Roles('customer_service', 'manager')
  approveReschedule(@Param('id', ParseIntPipe) id: number,
                    @Param('cid', ParseIntPipe) cid: number,
                    @Body() body: any, @Req() req: any) {
    return this.wf.approveReschedule(id, cid, body, req.user);
  }

  @Post('appointments/:id/video-witness')
  videoWitness(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.setVideoWitness(id, body, req.user);
  }

  // —— 家属确认 ——
  @Post('appointments/:id/confirmations/:cid/respond')
  respond(@Param('id', ParseIntPipe) id: number,
          @Param('cid', ParseIntPipe) cid: number,
          @Body() body: any, @Req() req: any) {
    return this.wf.respondConfirmation(id, cid, body, req.user);
  }

  // —— 接送员 ——
  @Post('appointments/:id/driver-delay')
  @Roles('driver', 'customer_service', 'manager')
  driverDelay(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.driverDelay(id, body, req.user);
  }

  @Post('appointments/:id/pickup')
  @Roles('driver', 'manager')
  pickup(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.pickup(id, body, req.user);
  }

  @Post('appointments/:id/cold-in')
  @Roles('driver', 'ceremonialist', 'manager')
  coldIn(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.intoCold(id, body, req.user);
  }

  // —— 礼仪师 ——
  @Post('appointments/:id/farewell-start')
  @Roles('ceremonialist', 'manager')
  farewellStart(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.startFarewell(id, body, req.user);
  }

  @Post('appointments/:id/farewell-end')
  @Roles('ceremonialist', 'manager')
  farewellEnd(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.endFarewell(id, body, req.user);
  }

  // —— 火化师 ——
  @Post('appointments/:id/cremation-start')
  @Roles('cremator', 'manager')
  cremationStart(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.startCremation(id, body, req.user);
  }

  @Post('appointments/:id/cremation-complete')
  @Roles('cremator', 'manager')
  cremationComplete(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.completeCremation(id, body, req.user);
  }

  // —— 纪念品 ——
  @Post('mementos/:mid/:action')
  @Roles('artisan', 'customer_service', 'manager', 'artisan_supervisor')
  memento(@Param('mid', ParseIntPipe) mid: number,
          @Param('action') action: 'start' | 'fail' | 'remake' | 'done',
          @Body() body: any, @Req() req: any) {
    return this.wf.mementoAction(mid, action, body || {}, req.user);
  }

  // —— 纪念品失败处理：客服拟方案 / 制作主管复核 / 家属评价 ——
  @Post('memento-failures/:cid/propose')
  @Roles('customer_service', 'manager')
  proposeFailure(@Param('cid', ParseIntPipe) cid: number, @Body() body: any, @Req() req: any) {
    return this.wf.proposeFailureResolution(cid, body || {}, req.user);
  }

  @Post('memento-failures/:cid/review')
  @Roles('artisan_supervisor', 'manager')
  reviewFailure(@Param('cid', ParseIntPipe) cid: number, @Body() body: any, @Req() req: any) {
    return this.wf.reviewFailureCase(cid, body || {}, req.user);
  }

  @Post('memento-failures/:cid/rate')
  @Roles('owner')
  rateFailure(@Param('cid', ParseIntPipe) cid: number, @Body() body: any, @Req() req: any) {
    return this.wf.rateFailureCase(cid, body || {}, req.user);
  }

  // —— 寄送 ——
  @Post('appointments/:id/shipment')
  @Roles('customer_service', 'manager', 'finance')
  shipment(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.createShipment(id, body, req.user);
  }

  @Post('shipments/:sid/:action')
  shipmentAction(@Param('sid', ParseIntPipe) sid: number,
                 @Param('action') action: 'delivered' | 'damage' | 'resend' | 'claim',
                 @Body() body: any, @Req() req: any) {
    return this.wf.shipmentAction(sid, action, body || {}, req.user);
  }

  // —— 柜位 ——
  @Get('lockers')
  lockers(@Req() req: any, @Query('status') status: string) {
    return this.wf.listLockers(req.user, status);
  }

  @Post('appointments/:id/locker-assign')
  @Roles('customer_service', 'manager')
  lockerAssign(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.assignLocker(id, body, req.user);
  }

  @Post('lockers/:lid/renew')
  @Roles('customer_service', 'manager', 'finance')
  renew(@Param('lid', ParseIntPipe) lid: number, @Body() body: any, @Req() req: any) {
    return this.wf.renewLocker(lid, body, req.user);
  }

  @Post('lockers/scan')
  @Roles('customer_service', 'manager')
  scan(@Req() req: any) { return this.wf.scanLockers(req.user); }

  // —— 回访 ——
  @Get('followups')
  followups(@Req() req: any, @Query('status') status: string) {
    return this.wf.listFollowups(req.user, status || 'scheduled');
  }

  @Post('followups/:fid/complete')
  @Roles('customer_service', 'manager')
  followupDone(@Param('fid', ParseIntPipe) fid: number, @Body() body: any, @Req() req: any) {
    return this.wf.completeFollowup(fid, body, req.user);
  }

  // —— 相册 / 消息 ——
  @Post('appointments/:id/album')
  album(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.addAlbum(id, body, req.user);
  }

  @Post('appointments/:id/messages')
  message(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.postMessage(id, req.user, body.content);
  }

  // —— 财务 ——
  @Post('appointments/:id/payment')
  @Roles('finance', 'manager')
  payment(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.recordPayment(id, body, req.user);
  }

  @Post('appointments/:id/refund')
  @Roles('finance', 'manager')
  refund(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.refund(id, body, req.user);
  }

  // —— 完结 / 取消 ——
  @Post('appointments/:id/complete')
  @Roles('customer_service', 'manager')
  complete(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.complete(id, body || {}, req.user);
  }

  @Post('appointments/:id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number, @Body() body: any, @Req() req: any) {
    return this.wf.cancel(id, body, req.user);
  }

  // —— 管理者 ——
  @Get('manager/overview')
  @Roles('manager')
  overview(@Query('store_id') sid: string) { return this.wf.managerOverview(sid ? Number(sid) : undefined); }

  @Post('hospitals')
  @Roles('customer_service', 'manager')
  createHospital(@Body() body: any, @Req() req: any) {
    return this.wf.createHospital(body, req.user);
  }
}
