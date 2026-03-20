# Stacks Manager Schedule UI Design

**Date:** 2026-03-20

## Goal

Làm lại UI trang `Stacks Manager` để:

- gọn hơn trong chế độ danh sách
- hiển thị rõ stack nào đang chiếm slot nào ngay trên row
- chỉ hiển thị slot trống và slot đang bị chiếm trong modal chỉnh schedule, không có panel slot riêng ở list

## Scope

Chỉ thay đổi trải nghiệm ở tab `Stacks` và modal schedule của stack. Không thay đổi cơ chế scheduler nền ngoài việc chuẩn hóa thời gian chọn trong UI thành slot 30 phút.

## Data Model

App hiện có một lịch cho mỗi stack trong `settings.stackSchedules[stackName]`.

- `manual`: không chiếm slot
- `daily`: chiếm một slot 30 phút trong ngày
- `weekly`: chiếm một slot 30 phút trong ngày, kèm `dayOfWeek`

Thời gian legacy không nằm đúng ranh giới 30 phút vẫn được đọc, nhưng sẽ được ánh xạ vào slot 30 phút chứa thời điểm đó để hiển thị xung đột và gợi ý.

## List Design

Mỗi stack vẫn là một row.

Mỗi row có 3 vùng:

1. thông tin stack: tên, số service, số volume
2. `Occupied slots`: badge tần suất + chip slot đang chiếm
3. actions: `Schedule`, `Backup All`, `Edit`, `Delete`

Hiển thị chính:

- stack `manual`: hiện badge `Manual`, không có chip slot
- stack `daily`: hiện chip kiểu `Daily` + `21:00-21:30`
- stack `weekly`: hiện chip kiểu `Weekly Sun` + `21:00-21:30`
- nếu slot đang trùng ngữ cảnh với stack khác thì chip đổi sang trạng thái cảnh báo

## Schedule Modal

Modal sẽ bỏ ô `input[type=time]` và thay bằng picker slot 30 phút.

Modal gồm:

1. chọn `manual` / `daily` / `weekly`
2. nếu `weekly` thì chọn `dayOfWeek`
3. lưới 48 slot trong ngày, mỗi slot là một button

Mỗi slot hiển thị:

- label slot: `HH:mm-HH:mm`
- trạng thái `available`, `occupied`, `selected`
- nếu bị chiếm thì hiện số stack và tên stack đang dùng slot đó trong ngữ cảnh đang chọn

Ngữ cảnh occupancy trong modal:

- đang chọn `daily`: so với các schedule `daily` của stack khác
- đang chọn `weekly` + một ngày cụ thể: so với các schedule `weekly` của stack khác cùng ngày
- stack hiện tại bị loại khỏi tập occupancy để không tự đánh dấu xung đột với chính nó

## Behavior Decisions

- Khi mở modal, schedule hiện tại của stack sẽ được ánh xạ sang slot gần nhất theo logic "slot chứa thời điểm đó"
- Khi bấm lưu, giá trị `time` được lưu về đầu slot (`HH:00` hoặc `HH:30`)
- `manual` không cần slot picker
- List không hiển thị panel slot trống

## Testing

Tạo helper thuần cho logic slot:

- chuẩn hóa `HH:mm` thành slot index
- format slot label
- tính occupied slot cho một stack
- tính occupancy cho modal theo ngữ cảnh `daily` / `weekly`

Test các case:

- legacy time như `21:10` map sang slot `21:00-21:30`
- `manual` không có occupied slot
- modal `daily` chỉ tính stack daily khác
- modal `weekly` chỉ tính stack weekly cùng ngày

## Risks

- UI file hiện tại lớn; thay đổi nên được gom thành helper nhỏ để tránh nhồi thêm logic vào component
- legacy schedules lệch 30 phút có thể đổi hiển thị so với trước, nhưng đây là thay đổi có chủ đích để nhất quán slot
