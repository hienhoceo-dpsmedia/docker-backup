# Tooling, Telemetry, and Deploy Design

**Date:** 2026-03-20

## Goal

Hoàn thiện 4 việc kế tiếp trong một đợt:

1. sửa lint setup để dùng được với Next 16 và ESLint 9
2. tách phần resource-tracking còn lại khỏi `app/actions.ts`
3. lọc `fdByPid` trước khi ghi history để telemetry bớt ồn
4. thêm deploy production workflow riêng, không tự deploy khi push `master`

Đồng thời bump version theo `minor` trước commit tiếp theo.

## Scope

- cập nhật tooling lint trong repo
- refactor nội bộ resource telemetry
- đổi hành vi persist FD telemetry
- thêm workflow release/deploy cho production
- cập nhật note/doc liên quan

Không thay đổi backup semantics chính ngoài phần lọc telemetry và cách triển khai production workflow.

## Architecture

### Lint

Thay `next lint` bằng ESLint flat config tương thích ESLint 9.

- thêm `eslint.config.mjs`
- đổi `npm run lint` sang `eslint .`
- bỏ phụ thuộc vào CLI lint cũ của Next

### Resource Tracking

Phần resource tracking đang nhồi trong `app/actions.ts`.

Tách thành các helper nhỏ:

- CPU/memory snapshot helper
- disk pressure helper
- tracker state/finalization helper

`app/actions.ts` chỉ còn orchestration.

### FD Telemetry Filtering

Giữ thu thập `fdByPid`, nhưng trước khi ghi history sẽ lọc bớt:

- chỉ giữ top N PID đáng chú ý nhất
- bỏ entry có `fdPeak` quá thấp nếu không có `fdUtilPeakPct`
- cho phép điều chỉnh bằng env

Mục tiêu là history vẫn hữu ích nhưng không quá dài/noisy.

### Production Deploy

Giữ workflow `build-and-push` khi push `master/main`.

Thêm workflow production deploy riêng:

- chạy bằng `workflow_dispatch`
- pull image mới từ GHCR trên VPS
- redeploy service rõ ràng
- dùng GitHub Environment/secrets cho host, user, ssh key, target path

Tách `build` khỏi `deploy` để production không tự thay đổi chỉ vì có commit mới.

## Versioning

Bump `package.json` và `package-lock.json` từ `1.6.0` lên `1.7.0` trước commit batch này.

## Testing

- test helper cho FD filtering và resource-tracking helper
- chạy `npm run lint`
- chạy `node --test ...`
- chạy `npm run build`

## Risks

- workflow deploy production cần secret SSH đúng; nếu thiếu sẽ phải dừng ở mức thêm workflow/documentation
- refactor `app/actions.ts` dễ gây regression nếu gom helper quá tay; nên giữ refactor vừa đủ để file nhẹ hơn
